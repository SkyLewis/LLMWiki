import { App, TFile } from "obsidian";
import { ModelRouter, TaskType } from "../llm/model-router";
import { PromptBuilder } from "../llm/prompt-builder";
import type { LLMWikiSettings } from "../ui/settings-tab";

interface VectorEntry {
	embedding: number[];
	semantic_desc: string;
}

export class SemanticIndex {
	private app: App;
	private settings: LLMWikiSettings;
	private modelRouter: ModelRouter;
	private promptBuilder: PromptBuilder;
	private vectorsPath: string;
	private store: Record<string, VectorEntry>;

	private constructor(
		app: App,
		settings: LLMWikiSettings,
		modelRouter: ModelRouter,
		promptBuilder: PromptBuilder,
		store: Record<string, VectorEntry>
	) {
		this.app = app;
		this.settings = settings;
		this.modelRouter = modelRouter;
		this.promptBuilder = promptBuilder;
		this.vectorsPath = `${settings.llmWikiDir}/vectors.json`;
		this.store = store;
	}

	static async load(
		app: App,
		settings: LLMWikiSettings,
		modelRouter: ModelRouter,
		promptBuilder: PromptBuilder
	): Promise<SemanticIndex> {
		const vectorsPath = `${settings.llmWikiDir}/vectors.json`;
		const file = app.vault.getAbstractFileByPath(vectorsPath);

		let store: Record<string, VectorEntry> = {};
		if (file instanceof TFile) {
			try {
				const content = await app.vault.read(file);
				store = JSON.parse(content);
			} catch {
				store = {};
			}
		}

		return new SemanticIndex(app, settings, modelRouter, promptBuilder, store);
	}

	/**
	 * Generate semantic description and optionally embedding for a page
	 */
	async indexPage(path: string, content: string, abortSignal?: AbortSignal): Promise<void> {
		// Generate semantic description
		const title = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
		const { provider: descProvider, tier: descTier } = this.modelRouter.resolve("semantic-desc");

		const descResult = await descProvider.complete([
			{ role: "user", content: this.promptBuilder.buildSemanticDescPrompt(title, content) },
		], { abortSignal, maxTokens: 100 });

		this.modelRouter.recordCost({
			tier: descTier,
			taskType: "semantic-desc",
			inputTokens: descResult.usage.inputTokens,
			outputTokens: descResult.usage.outputTokens,
			timestamp: Date.now(),
		});

		const semanticDesc = descResult.text.trim();

		// Optionally generate embedding
		let embedding: number[] = [];
		if (this.settings.enableSemanticSearch && this.settings.embeddingSource === "provider") {
			try {
				const { provider: embedProvider } = this.modelRouter.resolve("embed");
				if (embedProvider.embed) {
					const embedResult = await embedProvider.embed([semanticDesc], abortSignal);
					embedding = embedResult.embeddings[0] ?? [];
				}
			} catch {
				// Embedding failure is non-fatal
			}
		}

		this.store[path] = { embedding, semantic_desc: semanticDesc };
		await this.save();
	}

	/**
	 * Remove a page from the index
	 */
	removePage(path: string): void {
		delete this.store[path];
	}

	/**
	 * Find similar pages by cosine similarity
	 */
	findSimilar(queryEmbedding: number[], topK: number = 5): { path: string; score: number; semantic_desc: string }[] {
		const results: { path: string; score: number; semantic_desc: string }[] = [];

		for (const [path, entry] of Object.entries(this.store)) {
			if (!entry.embedding || entry.embedding.length === 0) continue;
			const score = this.cosineSimilarity(queryEmbedding, entry.embedding);
			results.push({ path, score, semantic_desc: entry.semantic_desc });
		}

		return results.sort((a, b) => b.score - a.score).slice(0, topK);
	}

	/**
	 * Full rebuild: regenerate all embeddings
	 */
	async rebuild(pagePaths: string[], abortSignal?: AbortSignal): Promise<void> {
		this.store = {};

		for (const path of pagePaths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;

			try {
				const content = await this.app.vault.read(file);
				await this.indexPage(path, content, abortSignal);
			} catch {
				continue;
			}
		}
	}

	/**
	 * Persist to disk
	 */
	async save(): Promise<void> {
		const content = JSON.stringify(this.store, null, 2);
		const file = this.app.vault.getAbstractFileByPath(this.vectorsPath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(this.vectorsPath, content);
		}
	}

	private cosineSimilarity(a: number[], b: number[]): number {
		if (a.length !== b.length) return 0;
		let dot = 0, normA = 0, normB = 0;
		for (let i = 0; i < a.length; i++) {
			dot += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}
		const denom = Math.sqrt(normA) * Math.sqrt(normB);
		return denom === 0 ? 0 : dot / denom;
	}
}
