import { App, TFile, TFolder } from "obsidian";
import { ModelRouter, TaskType } from "../llm/model-router";
import { PromptBuilder } from "../llm/prompt-builder";
import { LLMMessage } from "../llm/provider";
import { GraphIndex } from "./graph-index";
import { MarkdownAST } from "../parser/markdown-ast";
import { Transaction } from "../engine/transaction";
import type { LLMWikiSettings } from "../ui/settings-tab";

export interface LintIssue {
	type: "orphan" | "broken_reference" | "contradiction" | "stale" | "missing_page" | "refactoring_candidate" | "dangling_edge" | "schema_proposal";
	path?: string;
	description: string;
	severity: "info" | "warning" | "error";
	details?: Record<string, unknown>;
}

export interface LintReport {
	issues: LintIssue[];
	totalPages: number;
	issuesByType: Record<string, number>;
	schemaProposals: SchemaProposal[];
}

export interface SchemaProposal {
	category: string;
	section: string;
	prevalence: string;
	proposal: string;
	affectedPages: number;
	totalPages: number;
}

export class LintEngine {
	private app: App;
	private settings: LLMWikiSettings;
	private modelRouter: ModelRouter;
	private promptBuilder: PromptBuilder;
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
		this.graphIndex = graphIndex;
	}

	/**
	 * Run a full lint scan on the wiki
	 */
	async lint(abortSignal?: AbortSignal): Promise<LintReport> {
		const issues: LintIssue[] = [];
		const wikiFolder = this.app.vault.getAbstractFileByPath(this.settings.wikiPath);
		if (!(wikiFolder instanceof TFolder)) {
			return { issues: [], totalPages: 0, issuesByType: {}, schemaProposals: [] };
		}

		const allPages = this.collectMarkdownFiles(wikiFolder);
		const wikiLinks = new Map<string, Set<string>>(); // page -> set of pages it links to
		const linkedFrom = new Map<string, Set<string>>(); // page -> set of pages linking to it
		const allSlugs = new Set<string>();

		// Phase 1: Scan all pages
		for (const file of allPages) {
			if (file.path.endsWith("index.md") || file.path.endsWith("log.md")) continue;

			const content = await this.app.vault.read(file);
			const ast = await MarkdownAST.parse(content);
			const slug = file.basename;
			allSlugs.add(slug);

			// Extract wiki-links
			const links = ast.extractWikiLinks();
			const linkTargets = new Set<string>();
			for (const link of links) {
				linkTargets.add(link.target);
				if (!linkedFrom.has(link.target)) {
					linkedFrom.set(link.target, new Set());
				}
				linkedFrom.get(link.target)!.add(slug);
			}
			wikiLinks.set(slug, linkTargets);

			// Check for broken references
			for (const link of links) {
				if (!allSlugs.has(link.target) && !this.pageExists(link.target, allPages)) {
					issues.push({
						type: "broken_reference",
						path: file.path,
						description: `References [[${link.target}]] which does not exist`,
						severity: "warning",
						details: { ref: link.target },
					});
				}
			}

			// Check for contradictions
			if (content.includes("⚠️ Contradiction")) {
				const contradictionCount = (content.match(/⚠️ Contradiction/g) ?? []).length;
				issues.push({
					type: "contradiction",
					path: file.path,
					description: `Contains ${contradictionCount} contradiction annotation(s)`,
					severity: "info",
					details: { count: contradictionCount },
				});
			}

			// Check for refactoring candidates
			const frontmatter = ast.extractFrontmatter();
			if (frontmatter.needs_refactor === "true" || frontmatter.needs_refactor === true) {
				issues.push({
					type: "refactoring_candidate",
					path: file.path,
					description: `Flagged for refactoring (exceeds word threshold or too many append sections)`,
					severity: "info",
				});
			} else {
				const wordCount = this.countWords(content);
				if (wordCount > this.settings.mergeThreshold) {
					issues.push({
						type: "refactoring_candidate",
						path: file.path,
						description: `Exceeds word threshold (${wordCount} > ${this.settings.mergeThreshold})`,
						severity: "info",
						details: { wordCount },
					});
				}
			}
		}

		// Phase 2: Find orphan pages
		for (const slug of allSlugs) {
			const inbound = linkedFrom.get(slug);
			if (!inbound || inbound.size === 0) {
				const path = this.findPagePath(slug, allPages);
				issues.push({
					type: "orphan",
					path,
					description: `No other pages link to this page`,
					severity: "info",
				});
			}
		}

		// Phase 3: Dangling graph edges
		const danglingEdges = this.graphIndex.findDanglingEdges();
		for (const edge of danglingEdges) {
			issues.push({
				type: "dangling_edge",
				description: `Graph edge from "${edge.from}" to "${edge.to}" (${edge.rel}) references missing node`,
				severity: "warning",
				details: { from: edge.from, to: edge.to, rel: edge.rel },
			});
		}

		// Phase 4: Schema evolution detection
		const schemaProposals = await this.detectSchemaDrift(allPages);

		for (const proposal of schemaProposals) {
			issues.push({
				type: "schema_proposal",
				description: `${proposal.category}: ${proposal.prevalence} have "${proposal.section}". ${proposal.proposal}`,
				severity: "info",
				details: proposal as unknown as Record<string, unknown>,
			});
		}

		// Build summary
		const issuesByType: Record<string, number> = {};
		for (const issue of issues) {
			issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1;
		}

		return {
			issues,
			totalPages: allPages.length,
			issuesByType,
			schemaProposals,
		};
	}

	/**
	 * Refactor a page: heavy_lift model rewrites the full page
	 */
	async refactorPage(path: string, abortSignal?: AbortSignal): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`Page not found: ${path}`);

		const content = await this.app.vault.read(file);

		const { provider, tier } = this.modelRouter.resolve("lint-analyze");
		const messages: LLMMessage[] = [
			{
				role: "system",
				content: "You are a wiki page refactoring engine. Rewrite the page as a clean, consolidated version. Preserve all knowledge and [[wiki-links]]. Remove redundant dated append sections, merging their content into coherent sections. Maintain frontmatter.",
			},
			{
				role: "user",
				content: `Refactor this wiki page:\n\n${content}`,
			},
		];

		const result = await provider.complete(messages, {
			abortSignal,
			maxTokens: 8192,
		});

		this.modelRouter.recordCost({
			tier,
			taskType: "lint-analyze",
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			timestamp: Date.now(),
		});

		return result.text;
	}

	/**
	 * Clean up dangling graph edges
	 */
	async cleanupDanglingEdges(): Promise<number> {
		const cleaned = this.graphIndex.cleanDanglingEdges();
		if (cleaned > 0) {
			await this.graphIndex.save();
		}
		return cleaned;
	}

	/**
	 * Detect schema drift: find sections common in pages but missing from schema template
	 */
	private async detectSchemaDrift(allPages: TFile[]): Promise<SchemaProposal[]> {
		const proposals: SchemaProposal[] = [];

		// Group pages by category (from frontmatter)
		const categoryPages = new Map<string, TFile[]>();
		for (const file of allPages) {
			if (file.path.endsWith("index.md") || file.path.endsWith("log.md")) continue;
			try {
				const content = await this.app.vault.read(file);
				const ast = await MarkdownAST.parse(content);
				const frontmatter = ast.extractFrontmatter();
				const category = (frontmatter.type as string) ?? "unknown";

				if (!categoryPages.has(category)) categoryPages.set(category, []);
				categoryPages.get(category)!.push(file);
			} catch {
				continue;
			}
		}

		// For each category with enough pages, detect common sections
		for (const [category, pages] of categoryPages) {
			if (pages.length < this.settings.schemaMinSampleSize) continue;

			const sectionCounts = new Map<string, number>();

			for (const file of pages) {
				try {
					const content = await this.app.vault.read(file);
					const ast = await MarkdownAST.parse(content);
					const sections = ast.extractSections();

					for (const section of sections) {
						if (section.heading && !section.heading.startsWith("⚠️") && !section.heading.match(/^\d{4}-\d{2}-\d{2}/)) {
							sectionCounts.set(section.heading, (sectionCounts.get(section.heading) ?? 0) + 1);
						}
					}
				} catch {
					continue;
				}
			}

			// Find sections that appear in >threshold% of pages
			const threshold = this.settings.schemaDriftPercentage / 100;
			for (const [section, count] of sectionCounts) {
				const prevalence = count / pages.length;
				if (prevalence >= threshold) {
					// Check if this section is already in the schema template
					const schema = this.promptBuilder.getSchema();
					const templateKey = `${category}Template` as keyof typeof schema;
					const template = schema?.[templateKey] ?? "";

					if (!template.includes(section)) {
						proposals.push({
							category,
							section,
							prevalence: `${Math.round(prevalence * 100)}% of ${pages.length} pages`,
							proposal: `Add "${section}" section to the ${category} page template`,
							affectedPages: count,
							totalPages: pages.length,
						});
					}
				}
			}
		}

		return proposals;
	}

	private collectMarkdownFiles(folder: TFolder): TFile[] {
		const files: TFile[] = [];
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				files.push(child);
			} else if (child instanceof TFolder) {
				files.push(...this.collectMarkdownFiles(child));
			}
		}
		return files;
	}

	private pageExists(slug: string, allPages: TFile[]): boolean {
		return allPages.some((f) => f.basename === slug);
	}

	private findPagePath(slug: string, allPages: TFile[]): string | undefined {
		return allPages.find((f) => f.basename === slug)?.path;
	}

	private countWords(content: string): number {
		const stripped = content
			.replace(/^---[\s\S]*?---/, "")
			.replace(/[#*_\[\]()>|`~-]/g, "")
			.replace(/\n+/g, " ")
			.trim();
		return stripped.split(/\s+/).filter((w) => w.length > 0).length;
	}
}
