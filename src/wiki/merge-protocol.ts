import { MarkdownAST } from "../parser/markdown-ast";
import { PageTemplates } from "../parser/templates";

export interface AppendSection {
	heading: string;
	content: string;
}

export interface ContradictionAnnotation {
	claimA: string;
	sourceA: string;
	claimB: string;
	sourceB: string;
	divergenceType: "context-dependent" | "factual" | "temporal" | "methodological" | "unresolved";
	analysis: string;
}

export interface MergeResult {
	newContent: string;
	isAppend: boolean;
	hasContradiction: boolean;
	needsRefactor: boolean;
	wordCount: number;
}

export class MergeProtocol {
	private mergeThreshold: number;

	constructor(mergeThreshold: number = 3000) {
		this.mergeThreshold = mergeThreshold;
	}

	/**
	 * Stage A — Append: add new knowledge as a dated subsection
	 */
	async append(
		existingContent: string,
		sections: AppendSection[],
		addSources: string[],
		sourceTitle: string
	): Promise<MergeResult> {
		const ast = await MarkdownAST.parse(existingContent);
		const date = new Date().toISOString().split("T")[0];

		// Append each section as a dated subsection
		for (const section of sections) {
			ast.appendSection(section.heading, section.content, 3);
		}

		// Add sources to the Sources section
		if (addSources.length > 0) {
			const sourceContent = addSources.map((s) => `- [[${s}]]`).join("\n");
			const added = ast.insertUnderHeading("Sources", sourceContent, 2);
			if (!added) {
				ast.appendSection("Sources", sourceContent, 2);
			}
		}

		const newContent = ast.toString();
		const wordCount = this.countWords(newContent);

		return {
			newContent,
			isAppend: true,
			hasContradiction: false,
			needsRefactor: wordCount > this.mergeThreshold,
			wordCount,
		};
	}

	/**
	 * Stage A+ — Structured Contradiction Annotation
	 */
	async appendWithContradiction(
		existingContent: string,
		sections: AppendSection[],
		addSources: string[],
		contradiction: ContradictionAnnotation,
		sourceTitle: string
	): Promise<MergeResult> {
		const ast = await MarkdownAST.parse(existingContent);
		const date = new Date().toISOString().split("T")[0];

		// Append insights
		for (const section of sections) {
			ast.appendSection(section.heading, section.content, 3);
		}

		// Append structured contradiction annotation
		const contradictionBlock = PageTemplates.createContradictionBlock(
			contradiction.claimA,
			contradiction.sourceA,
			contradiction.claimB,
			contradiction.sourceB,
			contradiction.divergenceType,
			contradiction.analysis,
			date
		);
		ast.appendSection(`⚠️ Contradiction [${date}]`, contradictionBlock.split("\n").slice(1).join("\n"), 2);

		// Add sources
		if (addSources.length > 0) {
			const sourceContent = addSources.map((s) => `- [[${s}]]`).join("\n");
			const added = ast.insertUnderHeading("Sources", sourceContent, 2);
			if (!added) {
				ast.appendSection("Sources", sourceContent, 2);
			}
		}

		// Mark needs_refactor in frontmatter if over threshold
		const newContent = ast.toString();
		const wordCount = this.countWords(newContent);

		if (wordCount > this.mergeThreshold) {
			ast.setFrontmatter({ needs_refactor: true });
		}

		return {
			newContent: ast.toString(),
			isAppend: true,
			hasContradiction: true,
			needsRefactor: wordCount > this.mergeThreshold,
			wordCount,
		};
	}

	/**
	 * Stage C — Periodic Refactoring: rewrite a bloated page into a clean consolidated version
	 */
	async refactor(existingContent: string, rewrittenContent: string): Promise<MergeResult> {
		const wordCount = this.countWords(rewrittenContent);

		return {
			newContent: rewrittenContent,
			isAppend: false,
			hasContradiction: false,
			needsRefactor: wordCount > this.mergeThreshold,
			wordCount,
		};
	}

	/**
	 * Check if a page content exceeds the merge threshold
	 */
	shouldFlagForRefactor(content: string): boolean {
		return this.countWords(content) > this.mergeThreshold;
	}

	/**
	 * Count append sections (## [YYYY-MM-DD] patterns) in content
	 */
	countAppendSections(content: string): number {
		const appendPattern = /##\s+\d{4}-\d{2}-\d{2}/g;
		return (content.match(appendPattern) ?? []).length;
	}

	private countWords(content: string): number {
		// Strip frontmatter, markdown syntax, and count words
		const stripped = content
			.replace(/^---[\s\S]*?---/, "")
			.replace(/[#*_\[\]()>|`~-]/g, "")
			.replace(/\n+/g, " ")
			.trim();
		return stripped.split(/\s+/).filter((w) => w.length > 0).length;
	}
}
