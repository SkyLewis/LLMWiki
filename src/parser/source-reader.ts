import { App, TFile, TFolder, Vault } from "obsidian";

export interface SourceFile {
	file: TFile;
	name: string;
	extension: string;
	path: string;
}

export class SourceReader {
	private app: App;
	private rawPath: string;

	constructor(app: App, rawPath: string) {
		this.app = app;
		this.rawPath = rawPath;
	}

	/**
	 * List all source files in the raw directory
	 */
	async listSources(): Promise<SourceFile[]> {
		const folder = this.app.vault.getAbstractFileByPath(this.rawPath);
		if (!(folder instanceof TFolder)) return [];

		return this.collectFiles(folder);
	}

	/**
	 * Read a source file's content
	 */
	async readSource(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			throw new Error(`Source file not found: ${path}`);
		}
		return this.app.vault.read(file);
	}

	/**
	 * Read a source file by TFile
	 */
	async readFile(file: TFile): Promise<string> {
		return this.app.vault.read(file);
	}

	/**
	 * Check if a path is a supported source format
	 */
	isSupportedSource(file: TFile): boolean {
		const supported = [".md", ".txt", ".markdown"];
		return supported.some((ext) => file.extension === ext.replace(".", ""));
	}

	private collectFiles(folder: TFolder): SourceFile[] {
		const files: SourceFile[] = [];

		for (const child of folder.children) {
			if (child instanceof TFile && this.isSupportedSource(child)) {
				files.push({
					file: child,
					name: child.basename,
					extension: child.extension,
					path: child.path,
				});
			} else if (child instanceof TFolder) {
				files.push(...this.collectFiles(child));
			}
		}

		return files;
	}
}
