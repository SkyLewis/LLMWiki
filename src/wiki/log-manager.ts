import { App, TFile } from "obsidian";

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

		const file = this.app.vault.getAbstractFileByPath(this.logPath);
		if (file instanceof TFile) {
			const existing = await this.app.vault.read(file);
			await this.app.vault.modify(file, existing + "\n" + line);
		} else if (file === null) {
			await this.app.vault.create(this.logPath, `# Wiki Log\n\n${line}\n`);
		} else {
			throw new Error(`Log path conflicts with existing folder: ${this.logPath}`);
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
			} else if (currentHeader && (operation || keyword)) {
				const entry = this.parseEntry(currentHeader);
				if (!entry) continue;

				const matchesOp = !operation || entry.operation === operation;
				const matchesKeyword = !keyword ||
					entry.title.toLowerCase().includes(keyword.toLowerCase()) ||
					entry.description.toLowerCase().includes(keyword.toLowerCase());

				if (matchesOp && matchesKeyword) {
					entries.push(entry);
				}

				if (entries.length >= limit) break;
			}
		}

		return entries;
	}

	private formatEntry(entry: LogEntry): string {
		const pages = entry.pagesTouched.length > 0
			? `\n- Pages: ${entry.pagesTouched.map((p) => `[[${p}]]`).join(", ")}`
			: "";
		const sources = entry.sourcesReferenced.length > 0
			? `\n- Sources: ${entry.sourcesReferenced.map((s) => `[[${s}]]`).join(", ")}`
			: "";
		const txId = entry.transactionId ? `\n- Transaction: ${entry.transactionId}` : "";

		return `## [${entry.timestamp}] ${entry.operation} | ${entry.title}\n${entry.description}${pages}${sources}${txId}`;
	}

	private parseEntry(line: string): LogEntry | null {
		const match = line.match(
			/^## \[([^\]]+)\]\s+(\w+)\s+\|\s+(.+)$/
		);
		if (!match) return null;

		return {
			timestamp: match[1],
			operation: match[2] as LogEntry["operation"],
			title: match[3].trim(),
			description: "",
			pagesTouched: [],
			sourcesReferenced: [],
		};
	}

	private async readContent(): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(this.logPath);
		if (file instanceof TFile) {
			return this.app.vault.read(file);
		}
		return "# Wiki Log\n\n";
	}
}
