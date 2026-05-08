import { App, TFile, TFolder, Notice } from "obsidian";
import { ModelRouter, TaskType, TokenCostEntry } from "../llm/model-router";
import { PromptBuilder } from "../llm/prompt-builder";
import { LLMMessage } from "../llm/provider";
import { MergeProtocol, AppendSection, ContradictionAnnotation } from "./merge-protocol";
import { GraphIndex, GraphNode, GraphEdge } from "./graph-index";
import { PageTemplates } from "../parser/templates";
import { MarkdownAST } from "../parser/markdown-ast";
import { Transaction } from "../engine/transaction";
import type { LLMWikiSettings } from "../ui/settings-tab";

export interface IngestResult {
	pagesCreated: string[];
	pagesUpdated: string[];
	contradictions: string[];
	graphNodesAdded: number;
	graphEdgesAdded: number;
}

interface ExtractionResult {
	summary: string;
	semantic_desc: string;
	entities: { name: string; type: string; description: string }[];
	concepts: { name: string; description: string; related: string[] }[];
	key_claims: string[];
	tags: string[];
	relationships: { from: string; to: string; rel: string }[];
}

interface SynthesisResult {
	new_pages: { path: string; category: string; title: string; content: string }[];
	updates: {
		path: string;
		append_sections: AppendSection[];
		add_sources: string[];
		flag_contradiction: ContradictionAnnotation | null;
	}[];
	source_page: { path: string; content: string };
	graph_updates: { nodes: GraphNode[]; edges: GraphEdge[] };
}

export class IngestEngine {
	private app: App;
	private settings: LLMWikiSettings;
	private modelRouter: ModelRouter;
	private promptBuilder: PromptBuilder;
	private mergeProtocol: MergeProtocol;
	private graphIndex: GraphIndex;

	constructor(
		app: App,
		settings: LLMWikiSettings,
		modelRouter: ModelRouter,
		promptBuilder: PromptBuilder,
		graphIndex: GraphIndex
	) {
		this.app = app;
		this.settings = settings;
		this.modelRouter = modelRouter;
		this.promptBuilder = promptBuilder;
		this.mergeProtocol = new MergeProtocol(settings.mergeThreshold);
		this.graphIndex = graphIndex;
	}

	/**
	 * Ingest a source file: two-phase LLM call → merge → graph update → diff review
	 */
	async ingest(sourcePath: string, abortSignal?: AbortSignal): Promise<IngestResult> {
		const sourceContent = await this.readSource(sourcePath);
		const sourceTitle = this.titleFromPath(sourcePath);

		// Phase 1: Extract (lightweight model)
		const { provider: extractProvider, tier: extractTier } = this.modelRouter.resolve("ingest-extract");
		const extractPrompt = this.promptBuilder.buildIngestExtractPrompt(sourceContent, sourceTitle);
		const extractMessages: LLMMessage[] = [
			{ role: "user", content: extractPrompt },
		];

		const extractResult = await extractProvider.complete(extractMessages, {
			abortSignal,
			jsonMode: true,
		});

		this.modelRouter.recordCost({
			tier: extractTier,
			taskType: "ingest-extract",
			inputTokens: extractResult.usage.inputTokens,
			outputTokens: extractResult.usage.outputTokens,
			timestamp: Date.now(),
		});

		const extraction = this.parseJSON<ExtractionResult>(extractResult.text);

		// Find existing wiki pages that may be relevant
		const existingPages = await this.findRelevantPages(extraction);

		// Phase 2: Synthesize (heavy_lift model)
		const { provider: synthProvider, tier: synthTier } = this.modelRouter.resolve("ingest-synthesize");
		const synthPrompt = this.promptBuilder.buildIngestSynthesizePrompt(
			sourceContent.substring(0, 3000), // truncate to save tokens
			sourceTitle,
			extractResult.text,
			existingPages
		);

		const synthResult = await synthProvider.complete(
			[{ role: "user", content: synthPrompt }],
			{ abortSignal, jsonMode: true }
		);

		this.modelRouter.recordCost({
			tier: synthTier,
			taskType: "ingest-synthesize",
			inputTokens: synthResult.usage.inputTokens,
			outputTokens: synthResult.usage.outputTokens,
			timestamp: Date.now(),
		});

		const synthesis = this.parseJSON<SynthesisResult>(synthResult.text);

		// Apply changes via merge protocol within a transaction
		const allFilePaths = [
			...synthesis.new_pages.map((p) => p.path),
			...synthesis.updates.map((u) => u.path),
			synthesis.source_page.path,
		];

		const tx = await Transaction.begin(this.app, this.settings.llmWikiDir, allFilePaths);

		try {
			const result: IngestResult = {
				pagesCreated: [],
				pagesUpdated: [],
				contradictions: [],
				graphNodesAdded: 0,
				graphEdgesAdded: 0,
			};

			// Create new pages
			for (const page of synthesis.new_pages) {
				await this.ensureDirectory(page.path);
				const file = this.app.vault.getAbstractFileByPath(page.path);
				if (file instanceof TFile) {
					await this.app.vault.modify(file, page.content);
					result.pagesUpdated.push(page.path);
				} else {
					await this.app.vault.create(page.path, page.content);
					result.pagesCreated.push(page.path);
				}
				await tx.recordOp(`create:${page.path}`);
			}

			// Update existing pages via merge protocol
			for (const update of synthesis.updates) {
				const file = this.app.vault.getAbstractFileByPath(update.path);
				if (!(file instanceof TFile)) continue;

				const existing = await this.app.vault.read(file);

				if (update.flag_contradiction) {
					const mergeResult = await this.mergeProtocol.appendWithContradiction(
						existing,
						update.append_sections,
						update.add_sources,
						update.flag_contradiction,
						sourceTitle
					);
					await this.app.vault.modify(file, mergeResult.newContent);
					result.contradictions.push(update.path);
				} else {
					const mergeResult = await this.mergeProtocol.append(
						existing,
						update.append_sections,
						update.add_sources,
						sourceTitle
					);
					await this.app.vault.modify(file, mergeResult.newContent);
				}

				result.pagesUpdated.push(update.path);
				await tx.recordOp(`update:${update.path}`);
			}

			// Create source summary page
			await this.ensureDirectory(synthesis.source_page.path);
			const sourceFile = this.app.vault.getAbstractFileByPath(synthesis.source_page.path);
			if (sourceFile instanceof TFile) {
				await this.app.vault.modify(sourceFile, synthesis.source_page.content);
				result.pagesUpdated.push(synthesis.source_page.path);
			} else {
				await this.app.vault.create(synthesis.source_page.path, synthesis.source_page.content);
				result.pagesCreated.push(synthesis.source_page.path);
			}
			await tx.recordOp(`source:${synthesis.source_page.path}`);

			// Update graph index
			if (synthesis.graph_updates) {
				for (const node of synthesis.graph_updates.nodes) {
					this.graphIndex.addNode(node);
					result.graphNodesAdded++;
				}
				for (const edge of synthesis.graph_updates.edges) {
					this.graphIndex.addEdge(edge as GraphEdge);
					result.graphEdgesAdded++;
				}
				await this.graphIndex.save();
			}

			// Commit transaction
			await tx.commit();
			return result;
		} catch (error) {
			await tx.rollback();
			throw error;
		}
	}

	private async readSource(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(`Source file not found: ${path}`);
		}
		return this.app.vault.read(file);
	}

	private titleFromPath(path: string): string {
		const parts = path.split("/");
		const filename = parts[parts.length - 1];
		return filename.replace(/\.(md|txt|markdown)$/, "");
	}

	private async findRelevantPages(extraction: ExtractionResult): Promise<{ path: string; content: string }[]> {
		const pages: { path: string; content: string }[] = [];
		const wikiFolder = this.app.vault.getAbstractFileByPath(this.settings.wikiPath);
		if (!(wikiFolder instanceof TFolder)) return pages;

		const searchTerms = [
			...extraction.entities.map((e) => e.name.toLowerCase()),
			...extraction.concepts.map((c) => c.name.toLowerCase()),
		];

		const collectFiles = (folder: TFolder): TFile[] => {
			const files: TFile[] = [];
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === "md") {
					files.push(child);
				} else if (child instanceof TFolder) {
					files.push(...collectFiles(child));
				}
			}
			return files;
		};

		for (const file of collectFiles(wikiFolder)) {
			const nameLower = file.basename.toLowerCase();
			if (searchTerms.some((term) => nameLower.includes(term))) {
				const content = await this.app.vault.read(file);
				pages.push({ path: file.path, content: content.substring(0, 2000) });
			}
		}

		return pages.slice(0, 5); // limit to avoid context overflow
	}

	private async ensureDirectory(filePath: string): Promise<void> {
		const dir = filePath.substring(0, filePath.lastIndexOf("/"));
		if (!dir) return;

		const parts = dir.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const folder = this.app.vault.getAbstractFileByPath(current);
			if (!folder) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	private parseJSON<T>(text: string): T {
		// Extract JSON from ```json code blocks only, handling newlines robustly
		const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n\s*```/);
		const jsonStr = jsonMatch?.[1] ?? text;
		return JSON.parse(jsonStr.trim());
	}
}
