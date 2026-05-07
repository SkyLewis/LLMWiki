import { App, TFile, TFolder } from "obsidian";
import { ModelRouter, TaskType } from "../llm/model-router";
import { PromptBuilder } from "../llm/prompt-builder";
import { LLMMessage } from "../llm/provider";
import { IndexManager } from "./index-manager";
import { GraphIndex } from "./graph-index";
import type { LLMWikiSettings } from "../ui/settings-tab";

export interface QueryResult {
	answer: string;
	sourcePages: string[];
	usedSemanticSearch: boolean;
	usedGraphTraversal: boolean;
}

export class QueryEngine {
	private app: App;
	private settings: LLMWikiSettings;
	private modelRouter: ModelRouter;
	private promptBuilder: PromptBuilder;
	private indexManager: IndexManager;
	private graphIndex: GraphIndex;

	constructor(
		app: App,
		settings: LLMWikiSettings,
		modelRouter: ModelRouter,
		promptBuilder: PromptBuilder,
		indexManager: IndexManager,
		graphIndex: GraphIndex
	) {
		this.app = app;
		this.settings = settings;
		this.modelRouter = modelRouter;
		this.promptBuilder = promptBuilder;
		this.indexManager = indexManager;
		this.graphIndex = graphIndex;
	}

	/**
	 * Query the wiki using three-tier retrieval: keyword → semantic → graph
	 */
	async query(question: string, abortSignal?: AbortSignal): Promise<QueryResult> {
		// Tier 1: Keyword search via index
		const keywordResults = await this.indexManager.search(question, undefined, 10);
		const candidatePaths = keywordResults.map((e) => `${e.link}.md`);

		// Tier 2: Semantic search (if enabled)
		let semanticPaths: string[] = [];
		if (this.settings.enableSemanticSearch) {
			semanticPaths = await this.semanticSearch(question, 5);
		}

		// Merge and deduplicate candidate paths
		const allPaths = [...new Set([...candidatePaths, ...semanticPaths])];

		// Tier 3: Graph traversal from candidates
		const candidateSlugs = allPaths.map((p) => {
			const parts = p.split("/");
			return parts[parts.length - 1].replace(/\.md$/, "");
		});

		const graphExpanded = this.graphIndex.traverse(
			candidateSlugs,
			this.settings.graphTraversalHops
		);

		const graphPaths = graphExpanded
			.map((n) => n.page)
			.filter((p): p is string => !!p);

		// Final deduplicated, limited set
		const finalPaths = [...new Set([...allPaths, ...graphPaths])].slice(0, 15);

		// Load page contents
		const contextPages = await this.loadPages(finalPaths);

		// Synthesize answer via LLM
		const { provider, tier } = this.modelRouter.resolve("query-answer");
		const prompt = this.promptBuilder.buildQueryPrompt(question, contextPages);

		const result = await provider.complete(
			[{ role: "user", content: prompt }],
			{ abortSignal }
		);

		this.modelRouter.recordCost({
			tier,
			taskType: "query-answer",
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			timestamp: Date.now(),
		});

		return {
			answer: result.text,
			sourcePages: finalPaths,
			usedSemanticSearch: semanticPaths.length > 0,
			usedGraphTraversal: graphPaths.length > 0,
		};
	}

	/**
	 * Semantic search using vector similarity
	 */
	private async semanticSearch(query: string, topK: number): Promise<string[]> {
		try {
			const { provider } = this.modelRouter.resolve("embed");
			if (!provider.embed) return [];

			const vectorsPath = `${this.settings.llmWikiDir}/vectors.json`;
			const file = this.app.vault.getAbstractFileByPath(vectorsPath);
			if (!(file instanceof TFile)) return [];

			const content = await this.app.vault.read(file);
			const store = JSON.parse(content) as Record<string, { embedding: number[]; semantic_desc: string }>;

			// Embed the query
			const queryResult = await provider.embed([query]);
			const queryVec = queryResult.embeddings[0];
			if (!queryVec) return [];

			// Compute cosine similarity with all stored embeddings
			const scores: { path: string; score: number }[] = [];
			for (const [path, data] of Object.entries(store)) {
				if (!data.embedding) continue;
				const score = this.cosineSimilarity(queryVec, data.embedding);
				scores.push({ path, score });
			}

			// Sort by similarity and return top-K
			scores.sort((a, b) => b.score - a.score);
			return scores.slice(0, topK).map((s) => s.path);
		} catch {
			return [];
		}
	}

	/**
	 * Load page contents for context assembly
	 */
	private async loadPages(paths: string[]): Promise<{ path: string; content: string }[]> {
		const pages: { path: string; content: string }[] = [];

		for (const path of paths) {
			// Verify page exists on disk before including
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;

			try {
				const content = await this.app.vault.read(file);
				// Truncate long pages to avoid context overflow
				pages.push({
					path: file.path.replace(/\.md$/, ""),
					content: content.substring(0, 3000),
				});
			} catch {
				continue;
			}
		}

		return pages;
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) return 0;
		let dot = 0;
		let normA = 0;
		let normB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		const denom = Math.sqrt(normA) * Math.sqrt(normB);
		return denom === 0 ? 0 : dot / denom;
	}
}
