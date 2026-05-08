import { App, TFile, TFolder } from "obsidian";
import { MarkdownAST } from "../parser/markdown-ast";

export interface IndexEntry {
	slug: string;
	link: string;
	summary: string;
	tags: string[];
	semantic_desc: string;
}

export class IndexManager {
	private app: App;
	private indexPath: string;

	constructor(app: App, wikiPath: string) {
		this.app = app;
		this.indexPath = `${wikiPath}/index.md`;
	}

	/**
	 * Incrementally update index entries for modified pages
	 */
	async updateEntries(entries: IndexEntry[]): Promise<void> {
		const ast = await this.loadOrCreate();

		// Build a map of existing entries by slug
		const sections = ast.extractSections();

		for (const entry of entries) {
			const entryLine = this.formatEntry(entry);

			// Try to find and replace existing entry
			const existingSection = sections.find(
				(s) => s.heading !== null && s.heading.includes(entry.slug)
			);

			if (existingSection) {
				// Replace the existing entry
				const raw = ast.toString();
				const entryRegex = new RegExp(
					`- \\[\\[${this.escapeRegex(entry.link)}\\]\\][^\\n]*`,
					"g"
				);
				const updated = raw.replace(entryRegex, entryLine);
				const newAst = await MarkdownAST.parse(updated);
				// Copy over the new AST
				Object.assign(ast, newAst);
			} else {
				// Append new entry under the appropriate category
				const category = this.categorizeSlug(entry.slug);
				const added = ast.insertUnderHeading(category, entryLine, 2);
				if (!added) {
					ast.appendSection(category, entryLine, 2);
				}
			}
		}

		await this.save(ast);
	}

	/**
	 * Remove entries for deleted pages
	 */
	async removeEntries(slugs: string[]): Promise<void> {
		let content = await this.readContent();

		for (const slug of slugs) {
			const lineRegex = new RegExp(`- \\[\\[[^\]]*${this.escapeRegex(slug)}[^\]]*\\]\\][^\\n]*\\n?`, "g");
			content = content.replace(lineRegex, "");
		}

		const ast = await MarkdownAST.parse(content);
		await this.save(ast);
	}

	/**
	 * Full rebuild: scan all wiki pages and regenerate the index
	 */
	async rebuild(wikiPath: string): Promise<void> {
		const folder = this.app.vault.getAbstractFileByPath(wikiPath);
		if (!(folder instanceof TFolder)) return;

		const entries: IndexEntry[] = [];
		await this.collectEntries(folder, entries);

		// Create fresh index
		let content = `# Wiki Index\n\n`;
		content += `> Auto-generated index. Updated: ${new Date().toISOString().split("T")[0]}\n\n`;

		const categories = this.groupByCategory(entries);
		for (const [category, catEntries] of categories) {
			content += `## ${category}\n\n`;
			for (const entry of catEntries) {
				content += this.formatEntry(entry) + "\n";
			}
			content += "\n";
		}

		const file = this.app.vault.getAbstractFileByPath(this.indexPath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else if (file === null) {
			await this.app.vault.create(this.indexPath, content);
		} else {
			throw new Error(`Index path conflicts with existing folder: ${this.indexPath}`);
		}
	}

	/**
	 * Search the index by keyword and tags
	 */
	async search(query: string, tags?: string[], limit: number = 10): Promise<IndexEntry[]> {
		const content = await this.readContent();
		const lines = content.split("\n");
		const entries: IndexEntry[] = [];
		const queryLower = query.toLowerCase();

		for (const line of lines) {
			if (!line.startsWith("- [[")) continue;

			const entry = this.parseEntryLine(line);
			if (!entry) continue;

			const matchesQuery =
				entry.slug.toLowerCase().includes(queryLower) ||
				entry.summary.toLowerCase().includes(queryLower) ||
				entry.semantic_desc.toLowerCase().includes(queryLower);

			const matchesTags =
				!tags || tags.some((t) => entry.tags.some((et) => et.toLowerCase().includes(t.toLowerCase())));

			if (matchesQuery && matchesTags) {
				entries.push(entry);
			}

			if (entries.length >= limit) break;
		}

		return entries;
	}

	/**
	 * Get all entries
	 */
	async getAllEntries(): Promise<IndexEntry[]> {
		const content = await this.readContent();
		const lines = content.split("\n");
		const entries: IndexEntry[] = [];

		for (const line of lines) {
			if (!line.startsWith("- [[")) continue;
			const entry = this.parseEntryLine(line);
			if (entry) entries.push(entry);
		}

		return entries;
	}

	private formatEntry(entry: IndexEntry): string {
		return `- [[${entry.link}]] | ${entry.summary} | ${entry.tags.join(", ")} | ${entry.semantic_desc}`;
	}

	private parseEntryLine(line: string): IndexEntry | null {
		const match = line.match(/- \[\[([^\]]+)\]\] \| (.+?) \| (.+?) \| (.+)/);
		if (!match) return null;

		const [, link, summary, tagsStr, semanticDesc] = match;
		const slug = link.replace(/\.[^.]+$/, "").split("/").pop() ?? link;

		return {
			slug,
			link,
			summary: summary.trim(),
			tags: tagsStr.split(",").map((t) => t.trim()).filter(Boolean),
			semantic_desc: semanticDesc.trim(),
		};
	}

	private categorizeSlug(slug: string): string {
		if (slug.includes("/entities/")) return "Entities";
		if (slug.includes("/concepts/")) return "Concepts";
		if (slug.includes("/sources/")) return "Sources";
		if (slug.includes("/synthesis/")) return "Synthesis";
		return "Other";
	}

	private groupByCategory(entries: IndexEntry[]): Map<string, IndexEntry[]> {
		const groups = new Map<string, IndexEntry[]>();
		for (const entry of entries) {
			const category = this.categorizeSlug(entry.slug);
			if (!groups.has(category)) groups.set(category, []);
			groups.get(category)!.push(entry);
		}
		return groups;
	}

	private async collectEntries(folder: TFolder, entries: IndexEntry[]): Promise<void> {
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === "md") {
				if (child.path === this.indexPath) continue;
				if (child.path.endsWith("log.md")) continue;

				try {
					const content = await this.app.vault.read(child);
					const ast = await MarkdownAST.parse(content);
					const frontmatter = ast.extractFrontmatter();

					const firstSection = ast.extractSections().find((s) => s.heading !== null);
					const summary = this.extractSummary(content);

					entries.push({
						slug: child.basename,
						link: child.path.replace(/\.md$/, ""),
						summary,
						tags: typeof frontmatter.tags === "string"
							? frontmatter.tags.split(",").map((t: string) => t.trim())
							: [],
						semantic_desc: (frontmatter.semantic_desc as string) ?? summary,
					});
				} catch {
					// skip unreadable files
				}
			} else if (child instanceof TFolder) {
				await this.collectEntries(child, entries);
			}
		}
	}

	private extractSummary(content: string): string {
		const lines = content
			.replace(/^---[\s\S]*?---/, "")
			.split("\n")
			.filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("- [["));

		return lines.slice(0, 2).join(" ").substring(0, 150).trim();
	}

	private async loadOrCreate(): Promise<MarkdownAST> {
		const content = await this.readContent();
		return MarkdownAST.parse(content);
	}

	private async readContent(): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(this.indexPath);
		if (file instanceof TFile) {
			return this.app.vault.read(file);
		}
		return `# Wiki Index\n\n> Auto-generated index.\n\n`;
	}

	private async save(ast: MarkdownAST): Promise<void> {
		const content = ast.toString();
		const file = this.app.vault.getAbstractFileByPath(this.indexPath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, content);
		} else if (file === null) {
			await this.app.vault.create(this.indexPath, content);
		} else {
			throw new Error(`Index path conflicts with existing folder: ${this.indexPath}`);
		}
	}

	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}
