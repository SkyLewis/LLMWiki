import { App, TFile, TFolder } from "obsidian";
import { IndexManager, IndexEntry } from "../wiki/index-manager";
import { GraphIndex } from "../wiki/graph-index";

export interface SearchResult {
	path: string;
	slug: string;
	score: number;
	matchType: "keyword" | "semantic" | "graph";
	snippet: string;
}

export class SearchEngine {
	private app: App;
	private indexManager: IndexManager;
	private graphIndex: GraphIndex;

	constructor(app: App, indexManager: IndexManager, graphIndex: GraphIndex) {
		this.app = app;
		this.indexManager = indexManager;
		this.graphIndex = graphIndex;
	}

	/**
	 * Keyword search over the index
	 */
	async keywordSearch(query: string, limit: number = 10): Promise<SearchResult[]> {
		const entries = await this.indexManager.search(query, undefined, limit * 2);
		const queryLower = query.toLowerCase();
		const queryTerms = queryLower.split(/\s+/).filter(Boolean);

		const scored: SearchResult[] = entries.map((entry) => {
			let score = 0;
			const slugLower = entry.slug.toLowerCase();
			const summaryLower = entry.summary.toLowerCase();
			const descLower = entry.semantic_desc.toLowerCase();

			// Exact slug match
			if (slugLower === queryLower) score += 10;
			// Slug contains query
			else if (slugLower.includes(queryLower)) score += 5;
			// Each term match in slug
			for (const term of queryTerms) {
				if (slugLower.includes(term)) score += 2;
				if (summaryLower.includes(term)) score += 1;
				if (descLower.includes(term)) score += 1;
			}

			return {
				path: `${entry.link}.md`,
				slug: entry.slug,
				score,
				matchType: "keyword" as const,
				snippet: entry.summary.substring(0, 200),
			};
		});

		return scored
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}

	/**
	 * Graph-expanded search: start from keyword results, traverse graph
	 */
	async graphExpandedSearch(query: string, hops: number = 2, limit: number = 15): Promise<SearchResult[]> {
		const keywordResults = await this.keywordSearch(query, limit);
		const keywordSlugs = keywordResults.map((r) => r.slug);

		const graphNodes = this.graphIndex.traverse(keywordSlugs, hops);

		const graphResults: SearchResult[] = graphNodes
			.filter((n) => !keywordSlugs.includes(n.id))
			.map((node) => ({
				path: node.page,
				slug: node.id,
				score: 0.5, // lower score than direct keyword match
				matchType: "graph" as const,
				snippet: `Related via graph: ${node.type}`,
			}));

		// Merge and deduplicate
		const allResults = [...keywordResults, ...graphResults];
		const seen = new Set<string>();
		return allResults.filter((r) => {
			if (seen.has(r.slug)) return false;
			seen.add(r.slug);
			return true;
		}).slice(0, limit);
	}
}
