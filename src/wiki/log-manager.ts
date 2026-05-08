import { App, TFolder } from "obsidian";

export interface LogEntry {
	timestamp: string;
	operation: "ingest" | "query" | "lint" | "refactor" | "workflow";
	title: string;
	description: string;
	pagesTouched: string[];
	sourcesReferenced: string[];
	transactionId?: string;
}

export class LogManager {
	private app: App;
	private logPath: string;

	constructor(app: App, wikiPath: string) {
		this.app = app;
		this.logPath = `${wikiPath}/log.md`;
	}

	/**
	 * Append a log entry (append-only, never modify existing content)
	 */
	async append(entry: LogEntry): Promise<void> {
		const line = this.formatEntry(entry);

		try {
			const existing = await this.app.vault.adapter.read(this.logPath);
			await this.app.vault.adapter.write(this.logPath, existing + "\n" + line);
		} catch {
			const dir = this.logPath.substring(0, this.logPath.lastIndexOf("/"));
			if (dir && !(this.app.vault.getAbstractFileByPath(dir) instanceof TFolder)) {
				try { await this.app.vault.createFolder(dir); } catch { /* already exists */ }
			}
			await this.app.vault.adapter.write(this.logPath, `# Wiki Log\n\n${line}\n`);
		}
	}

	/**
	 * Get the N most recent log entries
	 */
	async getRecent(count: number = 10): Promise<LogEntry[]> {
		const content = await this.readContent();
		const lines = content.split("\n").filter((l) => l.startsWith("## ["));

		return lines.slice(-count).map((line) => this.parseEntry(line)).filter((e): e is LogEntry => e !== null).reverse();
	}

	/**
	 * Search log entries by operation type or keyword
	 */
	async search(operation?: string, keyword?: string, limit: number = 20): Promise<LogEntry[]> {
		const content = await this.readContent();
		const lines = content.split("\n");

		const entries: LogEntry[] = [];
		let currentHeader = "";

		for (const line of lines) {
			if (line.startsWith("## [")) {
				currentHeader = line;
			} else if (currentHeader && line.startsWith("- ")) {
				const entry = this.parseEntry(currentHeader + "\n" + line);
				if (!entry) continue;

				if (operation && entry.operation !== operation) continue;
				if (keyword && !entry.title.toLowerCase().includes(keyword.toLowerCase()) && !entry.description.toLowerCase().includes(keyword.toLowerCase())) continue;

				entries.push(entry);
			}
		}

		return entries.slice(-limit).reverse();
	}

	private formatEntry(entry: LogEntry): string {
		const lines = [
			`## [${entry.timestamp}] ${entry.operation}: ${entry.title}`,
			`${entry.description}`,
			`- pages: ${entry.pagesTouched.join(", ") || "none"}`,
			`- sources: ${entry.sourcesReferenced.join(", ") || "none"}`,
		];
		if (entry.transactionId) {
			lines.push(`- tx: ${entry.transactionId}`);
		}
		return lines.join("\n");
	}

	private parseEntry(line: string): LogEntry | null {
		const match = line.match(/^## \[(.+?)\] (\w+): (.+)/);
		if (!match) return null;

		return {
			timestamp: match[1],
			operation: match[2] as LogEntry["operation"],
			title: match[3],
			description: "",
			pagesTouched: [],
			sourcesReferenced: [],
		};
	}

	private async readContent(): Promise<string> {
		try {
			return await this.app.vault.adapter.read(this.logPath);
		} catch {
			return "# Wiki Log\n\n";
		}
	}
}
