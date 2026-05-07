import { MarkdownAST } from "./markdown-ast";

export type PageCategory = "entity" | "concept" | "source" | "synthesis" | "comparison";

export interface PageTemplateData {
	title: string;
	tags: string[];
	semantic_desc: string;
	[key: string]: unknown;
}

export interface EntityTemplateData extends PageTemplateData {
	type: string; // person, org, product, technology
	description: string;
	key_facts?: string[];
	misconceptions?: string[];
	related?: string[];
	sources?: string[];
}

export interface ConceptTemplateData extends PageTemplateData {
	definition: string;
	core_principles?: string[];
	applications?: string[];
	related?: string[];
	sources?: string[];
}

export interface SourceTemplateData extends PageTemplateData {
	source_type: string; // article, paper, book, video
	authors?: string[];
	date?: string;
	summary: string;
	key_claims?: string[];
	entities_mentioned?: string[];
	concepts_mentioned?: string[];
	related_sources?: string[];
}

export interface SynthesisTemplateData extends PageTemplateData {
	thesis: string;
	supporting_evidence?: string[];
	counterarguments?: string[];
	conclusion?: string;
	sources?: string[];
}

export class PageTemplates {
	static async createEntityPage(data: EntityTemplateData): Promise<string> {
		const ast = MarkdownAST.createEmpty();
		ast.setFrontmatter({
			type: "entity",
			entity_type: data.type,
			tags: data.tags.join(", "),
			semantic_desc: data.semantic_desc,
		});

		let content = `# ${data.title}\n\n${data.description}\n`;

		if (data.key_facts?.length) {
			content += `\n## Key Facts\n\n`;
			for (const fact of data.key_facts) {
				content += `- ${fact}\n`;
			}
		}

		if (data.misconceptions?.length) {
			content += `\n## Common Misconceptions\n\n`;
			for (const m of data.misconceptions) {
				content += `- ${m}\n`;
			}
		}

		if (data.related?.length) {
			content += `\n## Related Concepts\n\n`;
			for (const r of data.related) {
				content += `- [[${r}]]\n`;
			}
		}

		if (data.sources?.length) {
			content += `\n## Sources\n\n`;
			for (const s of data.sources) {
				content += `- [[${s}]]\n`;
			}
		}

		return content;
	}

	static async createConceptPage(data: ConceptTemplateData): Promise<string> {
		let content = `---\ntype: concept\ntags: [${data.tags.join(", ")}]\nsemantic_desc: "${data.semantic_desc}"\n---\n\n`;
		content += `# ${data.title}\n\n${data.definition}\n`;

		if (data.core_principles?.length) {
			content += `\n## Core Principles\n\n`;
			for (const p of data.core_principles) {
				content += `- ${p}\n`;
			}
		}

		if (data.applications?.length) {
			content += `\n## Applications\n\n`;
			for (const a of data.applications) {
				content += `- ${a}\n`;
			}
		}

		if (data.related?.length) {
			content += `\n## Related Concepts\n\n`;
			for (const r of data.related) {
				content += `- [[${r}]]\n`;
			}
		}

		if (data.sources?.length) {
			content += `\n## Sources\n\n`;
			for (const s of data.sources) {
				content += `- [[${s}]]\n`;
			}
		}

		return content;
	}

	static async createSourcePage(data: SourceTemplateData): Promise<string> {
		let content = `---\ntype: source\nsource_type: ${data.source_type}\n`;
		if (data.authors?.length) content += `authors: [${data.authors.map((a) => `"${a}"`).join(", ")}]\n`;
		if (data.date) content += `date: "${data.date}"\n`;
		content += `tags: [${data.tags.join(", ")}]\nsemantic_desc: "${data.semantic_desc}"\n---\n\n`;

		content += `# ${data.title}\n\n${data.summary}\n`;

		if (data.key_claims?.length) {
			content += `\n## Key Claims\n\n`;
			for (const c of data.key_claims) {
				content += `- ${c}\n`;
			}
		}

		if (data.entities_mentioned?.length) {
			content += `\n## Entities Mentioned\n\n`;
			for (const e of data.entities_mentioned) {
				content += `- [[${e}]]\n`;
			}
		}

		if (data.concepts_mentioned?.length) {
			content += `\n## Concepts Mentioned\n\n`;
			for (const c of data.concepts_mentioned) {
				content += `- [[${c}]]\n`;
			}
		}

		if (data.related_sources?.length) {
			content += `\n## Related Sources\n\n`;
			for (const s of data.related_sources) {
				content += `- [[${s}]]\n`;
			}
		}

		return content;
	}

	static async createSynthesisPage(data: SynthesisTemplateData): Promise<string> {
		let content = `---\ntype: synthesis\ntags: [${data.tags.join(", ")}]\nsemantic_desc: "${data.semantic_desc}"\n---\n\n`;

		content += `# ${data.title}\n\n## Thesis\n\n${data.thesis}\n`;

		if (data.supporting_evidence?.length) {
			content += `\n## Supporting Evidence\n\n`;
			for (const e of data.supporting_evidence) {
				content += `- ${e}\n`;
			}
		}

		if (data.counterarguments?.length) {
			content += `\n## Counterarguments\n\n`;
			for (const c of data.counterarguments) {
				content += `- ${c}\n`;
			}
		}

		if (data.conclusion) {
			content += `\n## Conclusion\n\n${data.conclusion}\n`;
		}

		if (data.sources?.length) {
			content += `\n## Sources\n\n`;
			for (const s of data.sources) {
				content += `- [[${s}]]\n`;
			}
		}

		return content;
	}

	static createContradictionBlock(
		claimA: string,
		sourceA: string,
		claimB: string,
		sourceB: string,
		divergenceType: string,
		analysis: string,
		date: string
	): string {
		return `## ⚠️ Contradiction [${date}]
- **Claim A**: [[${sourceA}]] states "${claimA}"
- **Claim B**: [[${sourceB}]] states "${claimB}"
- **Divergence type**: ${divergenceType}
- **Analysis**: ${analysis}\n`;
	}
}
