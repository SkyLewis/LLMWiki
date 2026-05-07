import { App, TFile, TFolder } from "obsidian";

export type EdgeType = "is_part_of" | "supports" | "contradicts" | "introduces" | "evolves_from" | "related_to";
export type NodeType = "concept" | "entity" | "source" | "synthesis";

export interface GraphNode {
	id: string;
	type: NodeType;
	page: string;
}

export interface GraphEdge {
	from: string;
	to: string;
	rel: EdgeType;
}

export interface GraphData {
	nodes: Record<string, GraphNode>;
	edges: GraphEdge[];
}

export class GraphIndex {
	private app: App;
	private graphPath: string;
	private data: GraphData;

	private constructor(app: App, graphPath: string, data: GraphData) {
		this.app = app;
		this.graphPath = graphPath;
		this.data = data;
	}

	static async load(app: App, llmWikiDir: string): Promise<GraphIndex> {
		const graphPath = `${llmWikiDir}/graph.json`;
		const file = app.vault.getAbstractFileByPath(graphPath);

		let data: GraphData = { nodes: {}, edges: [] };
		if (file instanceof TFile) {
			try {
				const content = await app.vault.read(file);
				data = JSON.parse(content);
			} catch {
				data = { nodes: {}, edges: [] };
			}
		}

		return new GraphIndex(app, graphPath, data);
	}

	static async create(app: App, llmWikiDir: string): Promise<GraphIndex> {
		const graphPath = `${llmWikiDir}/graph.json`;
		const data: GraphData = { nodes: {}, edges: [] };

		const file = app.vault.getAbstractFileByPath(graphPath);
		if (file instanceof TFile) {
			await app.vault.modify(file, JSON.stringify(data, null, 2));
		} else {
			await app.vault.create(graphPath, JSON.stringify(data, null, 2));
		}

		return new GraphIndex(app, graphPath, data);
	}

	/**
	 * Add a node to the graph
	 */
	addNode(node: GraphNode): void {
		this.data.nodes[node.id] = node;
	}

	/**
	 * Add an edge to the graph
	 */
	addEdge(edge: GraphEdge): void {
		// Avoid duplicate edges
		const exists = this.data.edges.some(
			(e) => e.from === edge.from && e.to === edge.to && e.rel === edge.rel
		);
		if (!exists) {
			this.data.edges.push(edge);
		}
	}

	/**
	 * Remove a node and all its edges (inbound + outbound)
	 */
	removeNode(nodeId: string): void {
		delete this.data.nodes[nodeId];
		this.data.edges = this.data.edges.filter(
			(e) => e.from !== nodeId && e.to !== nodeId
		);
	}

	/**
	 * Remap a node ID (e.g., after page rename) — updates all edge references
	 */
	remapNode(oldId: string, newId: string): void {
		const node = this.data.nodes[oldId];
		if (!node) return;

		this.data.nodes[newId] = { ...node, id: newId };
		delete this.data.nodes[oldId];

		for (const edge of this.data.edges) {
			if (edge.from === oldId) edge.from = newId;
			if (edge.to === oldId) edge.to = newId;
		}
	}

	/**
	 * Update edge type (e.g., when user overrides divergence_type)
	 */
	updateEdgeType(from: string, to: string, newRel: EdgeType): void {
		const edge = this.data.edges.find((e) => e.from === from && e.to === to);
		if (edge) {
			edge.rel = newRel;
		}
	}

	/**
	 * Traverse the graph from a set of starting nodes, collecting adjacent pages
	 */
	traverse(startNodeIds: string[], maxHops: number = 2): GraphNode[] {
		const visited = new Set<string>();
		const result: GraphNode[] = [];
		let frontier = new Set(startNodeIds);

		for (let hop = 0; hop < maxHops; hop++) {
			const nextFrontier = new Set<string>();

			for (const nodeId of frontier) {
				if (visited.has(nodeId)) continue;
				visited.add(nodeId);

				const node = this.data.nodes[nodeId];
				if (node) {
					result.push(node);
				}

				// Collect adjacent nodes
				for (const edge of this.data.edges) {
					if (edge.from === nodeId && !visited.has(edge.to)) {
						nextFrontier.add(edge.to);
					}
					if (edge.to === nodeId && !visited.has(edge.from)) {
						nextFrontier.add(edge.from);
					}
				}
			}

			frontier = nextFrontier;
		}

		return result;
	}

	/**
	 * Find all edges of a specific type
	 */
	getEdgesByType(rel: EdgeType): GraphEdge[] {
		return this.data.edges.filter((e) => e.rel === rel);
	}

	/**
	 * Find all edges connected to a node
	 */
	getEdgesForNode(nodeId: string): GraphEdge[] {
		return this.data.edges.filter((e) => e.from === nodeId || e.to === nodeId);
	}

	/**
	 * Detect dangling edges (edges referencing nodes that don't exist in the graph)
	 */
	findDanglingEdges(): GraphEdge[] {
		return this.data.edges.filter(
			(e) => !this.data.nodes[e.from] || !this.data.nodes[e.to]
		);
	}

	/**
	 * Clean up dangling edges
	 */
	cleanDanglingEdges(): number {
		const before = this.data.edges.length;
		this.data.edges = this.data.edges.filter(
			(e) => this.data.nodes[e.from] && this.data.nodes[e.to]
		);
		return before - this.data.edges.length;
	}

	/**
	 * Get node by ID
	 */
	getNode(id: string): GraphNode | undefined {
		return this.data.nodes[id];
	}

	/**
	 * Get all nodes
	 */
	getAllNodes(): GraphNode[] {
		return Object.values(this.data.nodes);
	}

	/**
	 * Get all edges
	 */
	getAllEdges(): GraphEdge[] {
		return this.data.edges;
	}

	/**
	 * Persist graph to disk
	 */
	async save(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.graphPath);
		const content = JSON.stringify(this.data, null, 2);

		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else {
			await this.app.vault.create(this.graphPath, content);
		}
	}

	/**
	 * Full rebuild: scan all wiki pages for wiki-links and extract relationships
	 */
	async rebuild(wikiPath: string): Promise<void> {
		this.data = { nodes: {}, edges: [] };

		const folder = this.app.vault.getAbstractFileByPath(wikiPath);
		if (!(folder instanceof TFolder)) return;

		await this.scanFolder(folder);
		await this.save();
	}

	private async scanFolder(folder: TFolder): Promise<void> {
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				await this.indexFile(child);
			} else if (child instanceof TFolder) {
				await this.scanFolder(child);
			}
		}
	}

	private async indexFile(file: TFile): Promise<void> {
		const content = await this.app.vault.read(file);
		const slug = file.basename;

		// Determine node type from frontmatter
		const typeMatch = content.match(/^---\n[\s\S]*?type:\s*(\w+)/);
		const nodeType = (typeMatch?.[1] ?? "concept") as NodeType;

		this.addNode({ id: slug, type: nodeType, page: file.path });

		// Extract wiki-links → related_to edges
		const wikiLinkRegex = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g;
		let match: RegExpExecArray | null;
		while ((match = wikiLinkRegex.exec(content)) !== null) {
			const target = match[1].trim();
			this.addEdge({ from: slug, to: target, rel: "related_to" });
		}
	}
}
