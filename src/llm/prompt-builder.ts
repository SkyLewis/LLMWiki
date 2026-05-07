import { App, TFile } from "obsidian";

export interface SchemaInfo {
	version: string;
	entityTemplate: string;
	conceptTemplate: string;
	sourceTemplate: string;
	synthesisTemplate: string;
	conventions: string;
}

export class PromptBuilder {
	private schema: SchemaInfo | null = null;

	async loadSchema(app: App, schemaPath: string = ".llm-wiki/schema.md"): Promise<SchemaInfo> {
		const file = app.vault.getAbstractFileByPath(schemaPath);
		if (file instanceof TFile) {
			const content = await app.vault.read(file);
			this.schema = this.parseSchema(content);
		} else {
			this.schema = this.defaultSchema();
		}
		return this.schema;
	}

	getSchema(): SchemaInfo | null {
		return this.schema;
	}

	buildIngestExtractPrompt(sourceContent: string, sourceTitle: string): string {
		const schemaContext = this.schema
			? `The wiki follows this schema (v${this.schema.version}):\n${this.schema.conventions}\n`
			: "";

		return `You are a knowledge extraction engine for a personal wiki. ${schemaContext}
Analyze the following source and extract structured knowledge.

Source: "${sourceTitle}"

${sourceContent}

Return a JSON object with this exact structure:
{
  "summary": "one-paragraph summary of the source",
  "semantic_desc": "one-line semantic description for index (under 100 chars)",
  "entities": [{ "name": "Entity Name", "type": "person|org|product|technology", "description": "brief description" }],
  "concepts": [{ "name": "Concept Name", "description": "brief description", "related": ["related concept names"] }],
  "key_claims": ["claim 1", "claim 2"],
  "tags": ["tag1", "tag2"],
  "relationships": [{ "from": "entity/concept name", "to": "entity/concept name", "rel": "is_part_of|supports|contradicts|introduces|evolves_from|related_to" }]
}

Be thorough but precise. Only extract what is explicitly stated or clearly implied.`;
	}

	buildIngestSynthesizePrompt(
		sourceContent: string,
		sourceTitle: string,
		extractionResult: string,
		existingPages: { path: string; content: string }[]
	): string {
		const schemaContext = this.schema
			? `Wiki schema (v${this.schema.version}):\n${this.schema.conventions}\n`
			: "";

		const existingContext = existingPages.length > 0
			? `Existing wiki pages that may be relevant:\n${existingPages.map((p) => `--- ${p.path} ---\n${p.content.substring(0, 2000)}`).join("\n\n")}\n`
			: "";

		return `You are a wiki synthesis engine. ${schemaContext}
Given a source and its extraction, produce updates for the wiki. ${existingContext}

Source: "${sourceTitle}"
Extraction: ${extractionResult}

Return a JSON object:
{
  "new_pages": [{ "path": "wiki/concepts/name.md or wiki/entities/name.md", "category": "concept|entity|source", "title": "Page Title", "content": "full markdown page content following wiki schema" }],
  "updates": [{ "path": "wiki/path/to/existing.md", "append_sections": [{ "heading": "[YYYY-MM-DD] New Insights from [[source-title]]", "content": "markdown content to append" }], "add_sources": ["[[source-title]]"], "flag_contradiction": { "claim_a": "what existing wiki says", "claim_b": "what new source says", "divergence_type": "context-dependent|factual|temporal|methodological", "analysis": "brief analysis of the divergence" } | null }],
  "source_page": { "path": "wiki/sources/source-title.md", "content": "full markdown source summary page" },
  "graph_updates": { "nodes": [{ "id": "slug", "type": "concept|entity", "page": "wiki/path" }], "edges": [{ "from": "slug", "to": "slug", "rel": "is_part_of|supports|contradicts|introduces|evolves_from|related_to" }] }
}

Rules:
- For new pages, follow the wiki schema templates
- For updates, use append-first merge: add dated subsections, never delete existing content
- Only flag a contradiction when the new source genuinely conflicts with existing wiki content
- Use [[wiki-links]] for cross-references
- Extract relationships for the knowledge graph`;
	}

	buildQueryPrompt(question: string, contextPages: { path: string; content: string }[]): string {
		const schemaContext = this.schema
			? `Wiki schema (v${this.schema.version}):\n${this.schema.conventions}\n`
			: "";

		const context = contextPages
			.map((p) => `--- ${p.path} ---\n${p.content}`)
			.join("\n\n");

		return `You are answering questions based on a personal wiki. ${schemaContext}

Context pages from the wiki:
${context}

Question: ${question}

Provide a comprehensive answer that:
1. Synthesizes information from the context pages
2. Uses [[wiki-links]] to cite specific pages
3. Notes any contradictions or gaps in the wiki's knowledge
4. Suggests follow-up questions if relevant

Answer:`;
	}

	buildLintAnalyzePrompt(pages: { path: string; content: string }[], schemaContent: string): string {
		return `You are a wiki health analyzer. Examine these wiki pages and the schema for issues.

Schema:
${schemaContent}

Pages:
${pages.map((p) => `--- ${p.path} ---\n${p.content.substring(0, 1500)}`).join("\n\n")}

Return a JSON object:
{
  "orphan_pages": ["path/to/orphan.md"],
  "broken_references": [{ "from": "path/to/page.md", "ref": "missing-page" }],
  "contradictions": [{ "path": "path/to/page.md", "description": "contradiction description" }],
  "stale_pages": [{ "path": "path/to/page.md", "last_updated": "date", "reason": "why stale" }],
  "missing_pages": [{ "mentioned_in": "path/to/page.md", "missing": "referenced concept name" }],
  "refactoring_candidates": [{ "path": "path/to/page.md", "reason": "too long / too many append sections", "word_count": 0 }],
  "dangling_graph_edges": [{ "from": "slug", "to": "slug", "rel": "relationship type" }],
  "schema_proposals": [{ "category": "entity|concept|source", "section": "section name", "prevalence": "87% of N pages", "proposal": "add this section to template" }]
}`;
	}

	buildContradictionAnalysisPrompt(claimA: string, claimB: string, sourceA: string, sourceB: string): string {
		return `Analyze this knowledge contradiction:

Claim A (from ${sourceA}): ${claimA}
Claim B (from ${sourceB}): ${claimB}

Return a JSON object:
{
  "divergence_type": "context-dependent|factual|temporal|methodological",
  "analysis": "Brief analysis of why these claims diverge and whether they truly contradict or are contextually compatible",
  "resolution": "suggested resolution or note that more information is needed"
}`;
	}

	buildSemanticDescPrompt(pageTitle: string, pageContent: string): string {
		return `Generate a one-line semantic description (under 100 chars) for this wiki page. The description should capture the page's core topic for search/matching purposes.

Page: "${pageTitle}"
Content excerpt: ${pageContent.substring(0, 1000)}

Return only the description string, no JSON.`;
	}

	private parseSchema(content: string): SchemaInfo {
		// Extract version from frontmatter
		const versionMatch = content.match(/^---\n[\s\S]*?version:\s*["']?([^"'\n]+)["']?/);
		const version = versionMatch?.[1]?.trim() ?? "1.0.0";

		// Extract sections by headings
		const entityMatch = content.match(/## Entity Page Template\s*\n([\s\S]*?)(?=\n## |\n---|$)/);
		const conceptMatch = content.match(/## Concept Page Template\s*\n([\s\S]*?)(?=\n## |\n---|$)/);
		const sourceMatch = content.match(/## Source Page Template\s*\n([\s\S]*?)(?=\n## |\n---|$)/);
		const synthesisMatch = content.match(/## Synthesis Page Template\s*\n([\s\S]*?)(?=\n## |\n---|$)/);
		const conventionsMatch = content.match(/## Conventions\s*\n([\s\S]*?)(?=\n## |\n---|$)/);

		return {
			version,
			entityTemplate: entityMatch?.[1]?.trim() ?? "",
			conceptTemplate: conceptMatch?.[1]?.trim() ?? "",
			sourceTemplate: sourceMatch?.[1]?.trim() ?? "",
			synthesisTemplate: synthesisMatch?.[1]?.trim() ?? "",
			conventions: conventionsMatch?.[1]?.trim() ?? "",
		};
	}

	private defaultSchema(): SchemaInfo {
		return {
			version: "1.0.0",
			entityTemplate: "Standard entity page with: Overview, Key Facts, Common Misconceptions, Related Concepts, Sources",
			conceptTemplate: "Standard concept page with: Definition, Core Principles, Applications, Related Concepts, Sources",
			sourceTemplate: "Standard source page with: Summary, Key Claims, Entities Mentioned, Concepts Mentioned, Related Sources",
			synthesisTemplate: "Standard synthesis page with: Thesis, Supporting Evidence, Counterarguments, Conclusion, Sources",
			conventions: "Use [[wiki-links]] for cross-references. Append new insights as dated subsections. Flag contradictions with ⚠️ markers.",
		};
	}
}
