import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import type { Root, Content, Heading, Paragraph, Text, List, ListItem, PhrasingContent } from "mdast";
import { visit } from "unist-util-visit";

export interface FrontmatterData {
	[key: string]: unknown;
}

export interface WikiSection {
	heading: string | null;
	depth: number;
	content: Content[];
	rawContent: string;
}

export interface WikiLink {
	target: string;
	alias?: string;
}

export class MarkdownAST {
	private ast: Root;
	private raw: string;

	private constructor(ast: Root, raw: string) {
		this.ast = ast;
		this.raw = raw;
	}

	static async parse(markdown: string): Promise<MarkdownAST> {
		const processor = unified().use(remarkParse);
		const ast = processor.parse(markdown) as Root;
		return new MarkdownAST(ast, markdown);
	}

	static createEmpty(): MarkdownAST {
		const ast: Root = { type: "root", children: [] };
		return new MarkdownAST(ast, "");
	}

	getAST(): Root {
		return this.ast;
	}

	/**
	 * Extract YAML frontmatter as key-value pairs
	 */
	extractFrontmatter(): FrontmatterData {
		const first = this.ast.children[0];
		if (first?.type === "yaml") {
			return this.parseYamlString((first as { value: string }).value);
		}
		return {};
	}

	/**
	 * Extract all sections (content between headings)
	 */
	extractSections(): WikiSection[] {
		const sections: WikiSection[] = [];
		let current: WikiSection = { heading: null, depth: 0, content: [], rawContent: "" };

		for (const child of this.ast.children) {
			if (child.type === "heading") {
				if (current.content.length > 0 || current.heading !== null) {
					sections.push(current);
				}
				current = {
					heading: this.headingText(child as Heading),
					depth: (child as Heading).depth,
					content: [],
					rawContent: "",
				};
			} else {
				current.content.push(child);
			}
		}

		if (current.content.length > 0 || current.heading !== null) {
			sections.push(current);
		}

		return sections;
	}

	/**
	 * Extract all [[wiki-links]] from the document
	 */
	extractWikiLinks(): WikiLink[] {
		const links: WikiLink[] = [];
		const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

		let match: RegExpExecArray | null;
		while ((match = wikiLinkRegex.exec(this.raw)) !== null) {
			links.push({ target: match[1].trim(), alias: match[2]?.trim() });
		}

		return links;
	}

	/**
	 * Insert content under a specific heading
	 */
	insertUnderHeading(heading: string, content: string, depth: number = 2): boolean {
		const headingIndex = this.ast.children.findIndex(
			(child) => child.type === "heading" &&
				(child as Heading).depth === depth &&
				this.headingText(child as Heading) === heading
		);

		if (headingIndex === -1) return false;

		// Parse the content to insert
		const insertAst = unified().use(remarkParse).parse(content);
		const insertNodes = (insertAst as Root).children;

		// Find the position after the heading's section content
		let insertPos = headingIndex + 1;
		while (insertPos < this.ast.children.length) {
			const next = this.ast.children[insertPos];
			if (next.type === "heading") break;
			insertPos++;
		}

		this.ast.children.splice(insertPos, 0, ...insertNodes);
		return true;
	}

	/**
	 * Append content as a new section at the end
	 */
	appendSection(heading: string, content: string, depth: 1 | 2 | 3 | 4 | 5 | 6 = 2): void {
		this.ast.children.push({
			type: "heading",
			depth,
			children: [{ type: "text", value: heading }],
		});

		const contentAst = unified().use(remarkParse).parse(content);
		this.ast.children.push(...(contentAst as Root).children);
	}

	/**
	 * Replace the content of a section by heading name
	 */
	replaceSection(heading: string, newContent: string, depth: number = 2): boolean {
		const headingIndex = this.ast.children.findIndex(
			(child) => child.type === "heading" &&
				(child as Heading).depth === depth &&
				this.headingText(child as Heading) === heading
		);

		if (headingIndex === -1) return false;

		// Remove the old section content (everything until the next heading of same or lower depth)
		let endIdx = headingIndex + 1;
		while (endIdx < this.ast.children.length) {
			const next = this.ast.children[endIdx];
			if (next.type === "heading" && (next as Heading).depth <= depth) break;
			endIdx++;
		}

		// Remove old content (keep the heading itself)
		this.ast.children.splice(headingIndex + 1, endIdx - headingIndex - 1);

		// Insert new content
		const contentAst = unified().use(remarkParse).parse(newContent);
		this.ast.children.splice(headingIndex + 1, 0, ...(contentAst as Root).children);

		return true;
	}

	/**
	 * Add or update frontmatter
	 */
	setFrontmatter(data: FrontmatterData): void {
		const yamlStr = Object.entries(data)
			.map(([k, v]) => {
				if (typeof v === "string") return `${k}: "${v}"`;
				if (typeof v === "boolean") return `${k}: ${v}`;
				return `${k}: ${v}`;
			})
			.join("\n");

		// Remove existing yaml node
		if (this.ast.children[0]?.type === "yaml") {
			(this.ast.children[0] as { value: string }).value = yamlStr;
		} else {
			this.ast.children.unshift({ type: "yaml", value: yamlStr } as unknown as Content);
		}
	}

	/**
	 * Serialize AST back to markdown string
	 */
	toString(): string {
		const processor = unified().use(remarkStringify, {
			bullet: "-",
			fence: "`",
			fences: true,
			listItemIndent: "tab",
		});

		// Re-inject yaml frontmatter
		const yamlNode = this.ast.children.find((c) => c.type === "yaml");
		let result = processor.stringify(this.ast);

		if (yamlNode) {
			const yamlValue = (yamlNode as { value: string }).value;
			result = `---\n${yamlValue}\n---\n${result}`;
		}

		return result;
	}

	private headingText(heading: Heading): string {
		return heading.children
			.map((child) => {
				if (child.type === "text") return (child as Text).value;
				if ("children" in child) {
					return (child as { children: Text[] }).children.map((c) => c.value).join("");
				}
				return "";
			})
			.join("");
	}

	private parseYamlString(yaml: string): FrontmatterData {
		const data: FrontmatterData = {};
		for (const line of yaml.split("\n")) {
			const match = line.match(/^(\w+):\s*(.+)$/);
			if (match) {
				const [, key, value] = match;
				data[key] = value.trim().replace(/^["']|["']$/g, "");
			}
		}
		return data;
	}
}
