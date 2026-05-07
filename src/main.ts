import { Notice, Plugin, TFile } from "obsidian";
import { LLMWikiSettings, LLMWikiSettingTab, DEFAULT_SETTINGS } from "./ui/settings-tab";
import { StatusBar } from "./ui/status-bar";
import { IngestModal, DiffViewModal } from "./ui/ingest-modal";
import { QueryModal, QueryResultModal } from "./ui/query-modal";
import { LintViewModal } from "./ui/lint-view";
import { WorkflowModal, WorkflowResultModal } from "./ui/workflow-modal";
import { ModelRouter } from "./llm/model-router";
import { PromptBuilder } from "./llm/prompt-builder";
import { IngestEngine } from "./wiki/ingest";
import { IndexManager } from "./wiki/index-manager";
import { LogManager } from "./wiki/log-manager";
import { QueryEngine } from "./wiki/query";
import { LintEngine } from "./wiki/lint";
import { GraphIndex } from "./wiki/graph-index";
import { WorkflowEngine, WorkflowIntent } from "./wiki/workflows";
import { TaskQueue } from "./engine/task-queue";
import { Transaction } from "./engine/transaction";
import { SemanticIndex } from "./utils/semantic-index";
import { DiffEngine } from "./utils/diff";

export default class LLMWikiPlugin extends Plugin {
	settings!: LLMWikiSettings;
	statusBar!: StatusBar;
	modelRouter!: ModelRouter;
	promptBuilder!: PromptBuilder;
	ingestEngine!: IngestEngine;
	indexManager!: IndexManager;
	logManager!: LogManager;
	queryEngine!: QueryEngine;
	lintEngine!: LintEngine;
	graphIndex!: GraphIndex;
	workflowEngine!: WorkflowEngine;
	taskQueue!: TaskQueue;
	semanticIndex!: SemanticIndex;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Initialize status bar
		const statusBarEl = this.addStatusBarItem();
		this.statusBar = new StatusBar(statusBarEl);

		// Initialize core components
		this.modelRouter = new ModelRouter(this.settings.modelRouter);
		this.promptBuilder = new PromptBuilder();
		this.graphIndex = await GraphIndex.load(this.app, this.settings.llmWikiDir);
		this.indexManager = new IndexManager(this.app, this.settings.wikiPath);
		this.logManager = new LogManager(this.app, this.settings.wikiPath);
		this.taskQueue = new TaskQueue(this.app, this.settings.llmWikiDir);
		await this.taskQueue.load();

		// Initialize engines
		this.ingestEngine = new IngestEngine(
			this.app, this.settings, this.modelRouter, this.promptBuilder, this.graphIndex
		);
		this.queryEngine = new QueryEngine(
			this.app, this.settings, this.modelRouter, this.promptBuilder, this.indexManager, this.graphIndex
		);
		this.lintEngine = new LintEngine(
			this.app, this.settings, this.modelRouter, this.promptBuilder, this.graphIndex
		);
		this.workflowEngine = new WorkflowEngine(
			this.app, this.settings, this.modelRouter, this.promptBuilder, this.queryEngine, this.graphIndex, this.taskQueue
		);
		this.semanticIndex = await SemanticIndex.load(
			this.app, this.settings, this.modelRouter, this.promptBuilder
		);

		// Load schema
		await this.promptBuilder.loadSchema(this.app);

		// Initialize vault structure on first run
		await this.initializeVaultStructure();

		// Recover orphaned transactions
		await this.recoverTransactions();

		// Register task queue events
		this.taskQueue.on("running", (task) => {
			this.statusBar.setActive(task.description);
		});
		this.taskQueue.on("done", () => {
			this.statusBar.setIdle();
			this.updateCostDisplay();
		});
		this.taskQueue.on("failed", () => {
			this.statusBar.setIdle();
		});

		// Register settings tab
		this.addSettingTab(new LLMWikiSettingTab(this.app, this));

		// Register commands
		this.registerCommands();

		// Add ribbon icons
		this.addRibbonIcon("book-open", "LLM Wiki: Query", () => {
			this.openQueryModal();
		});

		this.addRibbonIcon("file-plus", "LLM Wiki: Ingest", () => {
			this.openIngestModal();
		});

		console.log("LLM Wiki plugin loaded");
	}

	onunload(): void {
		console.log("LLM Wiki plugin unloaded");
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		// Deep merge model router config
		if (this.settings.modelRouter) {
			this.settings.modelRouter = Object.assign(
				{},
				DEFAULT_SETTINGS.modelRouter,
				this.settings.modelRouter
			);
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Update model router with new config
		this.modelRouter.updateConfig(this.settings.modelRouter);
	}

	private registerCommands(): void {
		// Ingest commands
		this.addCommand({
			id: "llm-wiki-ingest-source",
			name: "Ingest Source",
			callback: () => this.openIngestModal(),
		});

		this.addCommand({
			id: "llm-wiki-ingest-current",
			name: "Ingest Current File",
			callback: () => this.ingestCurrentFile(),
		});

		// Query command
		this.addCommand({
			id: "llm-wiki-query",
			name: "Query Wiki",
			callback: () => this.openQueryModal(),
		});

		// Lint command
		this.addCommand({
			id: "llm-wiki-lint",
			name: "Lint Wiki",
			callback: () => this.runLint(),
		});

		// Workflow commands
		this.addCommand({
			id: "llm-wiki-deep-explore",
			name: "Deep Explore",
			callback: () => this.openWorkflowModal(),
		});

		this.addCommand({
			id: "llm-wiki-verify-claim",
			name: "Verify Claim",
			callback: () => this.openWorkflowModal(),
		});

		this.addCommand({
			id: "llm-wiki-trace-contradiction",
			name: "Trace Contradiction",
			callback: () => this.openWorkflowModal(),
		});

		this.addCommand({
			id: "llm-wiki-comprehensive-review",
			name: "Comprehensive Review",
			callback: () => this.openWorkflowModal(),
		});

		// Maintenance commands
		this.addCommand({
			id: "llm-wiki-rebuild-index",
			name: "Rebuild Index",
			callback: () => this.rebuildIndex(),
		});

		this.addCommand({
			id: "llm-wiki-rebuild-semantic-index",
			name: "Rebuild Semantic Index",
			callback: () => this.rebuildSemanticIndex(),
		});

		this.addCommand({
			id: "llm-wiki-rebuild-graph-index",
			name: "Rebuild Graph Index",
			callback: () => this.rebuildGraphIndex(),
		});

		this.addCommand({
			id: "llm-wiki-show-log",
			name: "Show Log",
			callback: () => this.showLog(),
		});

		this.addCommand({
			id: "llm-wiki-open-schema",
			name: "Open Schema",
			callback: () => this.openSchema(),
		});

		this.addCommand({
			id: "llm-wiki-cancel-task",
			name: "Cancel Current Task",
			callback: () => this.cancelCurrentTask(),
		});

		this.addCommand({
			id: "llm-wiki-recover-transaction",
			name: "Recover Interrupted Transaction",
			callback: () => this.recoverTransactions(),
		});

		this.addCommand({
			id: "llm-wiki-show-token-cost",
			name: "Show Token Cost",
			callback: () => this.showTokenCost(),
		});
	}

	// ── Ingest ──

	private openIngestModal(): void {
		const modal = new IngestModal(this.app, this, async (file) => {
			await this.runIngest(file.path);
		});
		modal.open();
	}

	private async ingestCurrentFile(): Promise<void> {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice("No active file");
			return;
		}
		await this.runIngest(file.path);
	}

	private async runIngest(sourcePath: string): Promise<void> {
		const task = await this.taskQueue.enqueue("ingest", `Ingesting: ${sourcePath}`, "default");

		try {
			const signal = this.taskQueue.getAbortSignal() ?? undefined;
			const result = await this.ingestEngine.ingest(sourcePath, signal);

			// Update index
			await this.indexManager.rebuild(this.settings.wikiPath);

			// Log the operation
			await this.logManager.append({
				timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
				operation: "ingest",
				title: sourcePath,
				description: `Ingested ${sourcePath}: ${result.pagesCreated.length} created, ${result.pagesUpdated.length} updated`,
				pagesTouched: [...result.pagesCreated, ...result.pagesUpdated],
				sourcesReferenced: [sourcePath],
			});

			await this.taskQueue.markDone(task.id);
			new Notice(`Ingest complete: ${result.pagesCreated.length} created, ${result.pagesUpdated.length} updated, ${result.contradictions.length} contradictions`);
		} catch (error) {
			await this.taskQueue.markFailed(task.id, String(error));
			new Notice(`Ingest failed: ${error}`);
		}
	}

	// ── Query ──

	private openQueryModal(): void {
		const modal = new QueryModal(this.app, this, async (query) => {
			await this.runQuery(query);
		});
		modal.open();
	}

	private async runQuery(question: string): Promise<void> {
		const task = await this.taskQueue.enqueue("query", `Query: ${question.substring(0, 50)}`, "default");

		try {
			const signal = this.taskQueue.getAbortSignal() ?? undefined;
			const result = await this.queryEngine.query(question, signal);

			await this.taskQueue.markDone(task.id);

			// Show result modal
			const resultModal = new QueryResultModal(this.app, result, () => {
				this.fileQueryAsPage(question, result.answer);
			});
			resultModal.open();
		} catch (error) {
			await this.taskQueue.markFailed(task.id, String(error));
			new Notice(`Query failed: ${error}`);
		}
	}

	private async fileQueryAsPage(question: string, answer: string): Promise<void> {
		const slug = question.substring(0, 50).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
		const path = `${this.settings.wikiPath}/synthesis/${slug}.md`;

		const content = `---\ntype: synthesis\ntags: [query-result]\nsemantic_desc: "${question.substring(0, 100)}"\n---\n\n# ${question}\n\n${answer}\n`;

		// Ensure directory
		const dir = path.substring(0, path.lastIndexOf("/"));
		if (!this.app.vault.getAbstractFileByPath(dir)) {
			await this.app.vault.createFolder(dir);
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(path, content);
		}

		await this.indexManager.rebuild(this.settings.wikiPath);
		new Notice(`Query result filed as ${path}`);
	}

	// ── Lint ──

	private async runLint(): Promise<void> {
		const task = await this.taskQueue.enqueue("lint", "Running lint scan", "heavy_lift");

		try {
			const signal = this.taskQueue.getAbortSignal() ?? undefined;
			const report = await this.lintEngine.lint(signal);

			await this.taskQueue.markDone(task.id);

			// Show lint report modal
			const modal = new LintViewModal(this.app, this, report, async (action, details) => {
				if (action === "refactor" && details?.path) {
					await this.refactorPage(details.path as string);
				} else if (action === "approve_schema" && details) {
					await this.approveSchemaProposal(details as any);
				} else if (action === "cleanup_edges") {
					const cleaned = await this.lintEngine.cleanupDanglingEdges();
					new Notice(`Cleaned up ${cleaned} dangling edge(s)`);
				}
			});
			modal.open();
		} catch (error) {
			await this.taskQueue.markFailed(task.id, String(error));
			new Notice(`Lint failed: ${error}`);
		}
	}

	private async refactorPage(path: string): Promise<void> {
		const task = await this.taskQueue.enqueue("refactor", `Refactoring: ${path}`, "heavy_lift");

		try {
			const signal = this.taskQueue.getAbortSignal() ?? undefined;
			const rewritten = await this.lintEngine.refactorPage(path, signal);

			// Read original for diff
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) throw new Error("File not found");
			const original = await this.app.vault.read(file);

			const diff = DiffEngine.compute(original, rewritten, path);

			// Show diff for approval
			const diffModal = new DiffViewModal(this.app, [diff], async (acceptedPaths) => {
				if (acceptedPaths.includes(path)) {
					const tx = await Transaction.begin(this.app, this.settings.llmWikiDir, [path]);
					try {
						await this.app.vault.modify(file, rewritten);
						await tx.commit();
						new Notice(`Refactored: ${path}`);
					} catch (err) {
						await tx.rollback();
						new Notice(`Refactor failed: ${err}`);
					}
				}
			});
			diffModal.open();

			await this.taskQueue.markDone(task.id);
		} catch (error) {
			await this.taskQueue.markFailed(task.id, String(error));
			new Notice(`Refactor failed: ${error}`);
		}
	}

	private async approveSchemaProposal(proposal: { category: string; section: string; proposal: string }): Promise<void> {
		// Read current schema
		const schemaPath = `${this.settings.llmWikiDir}/schema.md`;
		const file = this.app.vault.getAbstractFileByPath(schemaPath);

		if (file instanceof TFile) {
			let content = await this.app.vault.read(file);
			// Append the new section to the appropriate template
			const templateSection = `${proposal.category} Page Template`;
			const insertion = `\n### ${proposal.section}\n(Auto-detected from wiki pattern: ${proposal.proposal})\n`;

			if (content.includes(templateSection)) {
				const idx = content.indexOf(templateSection);
				const nextSection = content.indexOf("\n## ", idx + 1);
				if (nextSection > 0) {
					content = content.substring(0, nextSection) + insertion + content.substring(nextSection);
				} else {
					content += insertion;
				}
			} else {
				content += `\n## ${templateSection}${insertion}`;
			}

			// Bump schema minor version
			content = content.replace(/version:\s*"?(\d+)\.(\d+)\.(\d+)"?/, (_match, major, minor, patch) => {
				return `version: ${major}.${Number(minor) + 1}.${patch}`;
			});

			await this.app.vault.modify(file, content);
			await this.promptBuilder.loadSchema(this.app);
			new Notice(`Schema updated: added "${proposal.section}" to ${proposal.category} template`);
		}
	}

	// ── Workflows ──

	private openWorkflowModal(): void {
		const modal = new WorkflowModal(this.app, this, async (intent, input) => {
			await this.runWorkflow(intent, input);
		});
		modal.open();
	}

	private async runWorkflow(intent: WorkflowIntent, input: string): Promise<void> {
		const task = await this.taskQueue.enqueue("workflow", `Workflow: ${intent}`, "default");

		try {
			const signal = this.taskQueue.getAbortSignal() ?? undefined;
			const result = await this.workflowEngine.execute(intent, input, signal);

			await this.taskQueue.markDone(task.id);

			const resultModal = new WorkflowResultModal(this.app, result);
			resultModal.open();
		} catch (error) {
			await this.taskQueue.markFailed(task.id, String(error));
			new Notice(`Workflow failed: ${error}`);
		}
	}

	// ── Maintenance ──

	private async rebuildIndex(): Promise<void> {
		await this.indexManager.rebuild(this.settings.wikiPath);
		new Notice("Index rebuilt");
	}

	private async rebuildSemanticIndex(): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(this.settings.wikiPath);
		if (!folder) return;

		const files: string[] = [];
		const collect = (f: typeof folder): void => {
			if (f instanceof TFile && f.extension === "md") {
				files.push(f.path);
			} else if ("children" in f) {
				for (const child of (f as { children: typeof folder[] }).children) {
					collect(child);
				}
			}
		};
		collect(folder);

		await this.semanticIndex.rebuild(files);
		new Notice(`Semantic index rebuilt (${files.length} pages)`);
	}

	private async rebuildGraphIndex(): Promise<void> {
		await this.graphIndex.rebuild(this.settings.wikiPath);
		new Notice("Graph index rebuilt");
	}

	private showLog(): void {
		const file = this.app.vault.getAbstractFileByPath(`${this.settings.wikiPath}/log.md`);
		if (file instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(file);
		} else {
			new Notice("Log not found");
		}
	}

	private openSchema(): void {
		const file = this.app.vault.getAbstractFileByPath(`${this.settings.llmWikiDir}/schema.md`);
		if (file instanceof TFile) {
			this.app.workspace.getLeaf(false).openFile(file);
		} else {
			new Notice("Schema not found");
		}
	}

	private async cancelCurrentTask(): Promise<void> {
		const current = this.taskQueue.getCurrentTask();
		if (current) {
			await this.taskQueue.cancel(current.id);
			new Notice(`Cancelled: ${current.description}`);
		} else {
			new Notice("No task running");
		}
	}

	private showTokenCost(): void {
		const summary = this.modelRouter.getCostSummary();
		const lines = Object.entries(summary)
			.filter(([, v]) => v.count > 0)
			.map(([tier, v]) => `${tier}: ${v.inputTokens + v.outputTokens} tokens (${v.count} calls)`)
			.join("\n");

		if (lines) {
			new Notice(`Token Usage:\n${lines}`, 10000);
		} else {
			new Notice("No token usage recorded");
		}
	}

	// ── Initialization ──

	private async initializeVaultStructure(): Promise<void> {
		const dirs = [
			this.settings.rawPath,
			`${this.settings.rawPath}/articles`,
			`${this.settings.rawPath}/papers`,
			`${this.settings.rawPath}/notes`,
			`${this.settings.rawPath}/assets`,
			this.settings.wikiPath,
			`${this.settings.wikiPath}/entities`,
			`${this.settings.wikiPath}/concepts`,
			`${this.settings.wikiPath}/sources`,
			`${this.settings.wikiPath}/synthesis`,
			this.settings.llmWikiDir,
			`${this.settings.llmWikiDir}/tx`,
		];

		for (const dir of dirs) {
			if (!this.app.vault.getAbstractFileByPath(dir)) {
				try {
					await this.app.vault.createFolder(dir);
				} catch {
					// may already exist from parallel creation
				}
			}
		}

		// Create default files if they don't exist
		await this.ensureFile(`${this.settings.wikiPath}/index.md`, "# Wiki Index\n\n> Auto-generated index.\n\n");
		await this.ensureFile(`${this.settings.wikiPath}/log.md`, "# Wiki Log\n\n");
		await this.ensureFile(`${this.settings.llmWikiDir}/graph.json`, JSON.stringify({ nodes: {}, edges: [] }, null, 2));
		await this.ensureFile(`${this.settings.llmWikiDir}/vectors.json`, "{}");
		await this.ensureFile(`${this.settings.llmWikiDir}/queue.json`, JSON.stringify({ queue: [], updatedAt: new Date().toISOString() }, null, 2));

		// Create default schema
		await this.ensureFile(`${this.settings.llmWikiDir}/schema.md`, this.getDefaultSchema());
	}

	private async ensureFile(path: string, content: string): Promise<void> {
		if (!this.app.vault.getAbstractFileByPath(path)) {
			try {
				await this.app.vault.create(path, content);
			} catch {
				// may already exist
			}
		}
	}

	private getDefaultSchema(): string {
		return `---
version: "1.0.0"
---

# LLM Wiki Schema

This file defines the wiki's conventions and page templates. The LLM uses this schema to generate consistent pages.

## Conventions

- Use [[wiki-links]] for cross-references between pages
- Append new insights as dated subsections: ## [YYYY-MM-DD] New Insights from [[source]]
- Flag contradictions with ⚠️ markers and structured annotations
- Every page should have frontmatter with: type, tags, semantic_desc
- Source pages go in wiki/sources/, entity pages in wiki/entities/, concept pages in wiki/concepts/

## Entity Page Template

### Overview
Brief description of the entity.

### Key Facts
- Fact 1
- Fact 2

### Common Misconceptions
- Misconception 1

### Related Concepts
- [[related-concept]]

### Sources
- [[source-page]]

## Concept Page Template

### Definition
Clear definition of the concept.

### Core Principles
- Principle 1

### Applications
- Application 1

### Related Concepts
- [[related-concept]]

### Sources
- [[source-page]]

## Source Page Template

### Summary
One-paragraph summary of the source.

### Key Claims
- Claim 1

### Entities Mentioned
- [[entity-name]]

### Concepts Mentioned
- [[concept-name]]

### Related Sources
- [[other-source]]

## Synthesis Page Template

### Thesis
The main argument or synthesis.

### Supporting Evidence
- Evidence 1

### Counterarguments
- Counterargument 1

### Conclusion
Synthesized conclusion.

### Sources
- [[source-page]]
`;
	}

	private async recoverTransactions(): Promise<void> {
		const orphans = await Transaction.recoverOrphaned(this.app, this.settings.llmWikiDir);
		if (orphans.length > 0) {
			new Notice(`${orphans.length} interrupted transaction(s) found. Rolling back...`, 10000);
			for (const manifest of orphans) {
				await Transaction.rollbackOrphan(this.app, this.settings.llmWikiDir, manifest);
			}
			new Notice("All interrupted transactions rolled back.");
		}
	}

	private updateCostDisplay(): void {
		const summary = this.modelRouter.getCostSummary();
		this.statusBar.showCostTooltip(summary);
	}
}
