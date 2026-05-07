import { App, FuzzySuggestModal, TFile } from "obsidian";
import type LLMWikiPlugin from "../main";
import { DiffEngine, FileDiff } from "../utils/diff";

export class IngestModal extends FuzzySuggestModal<TFile> {
	private plugin: LLMWikiPlugin;
	private onChoose: (file: TFile) => void;

	constructor(app: App, plugin: LLMWikiPlugin, onChoose: (file: TFile) => void) {
		super(app);
		this.plugin = plugin;
		this.onChoose = onChoose;
		this.setPlaceholder("Select a source file to ingest...");
		this.setInstructions([{ command: "↑↓", purpose: "navigate" }, { command: "↵", purpose: "ingest" }, { command: "esc", purpose: "cancel" }]);
	}

	getItems(): TFile[] {
		const rawPath = this.plugin.settings.rawPath;
		const files: TFile[] = [];
		const folder = this.app.vault.getAbstractFileByPath(rawPath);
		if (!folder) return files;

		const collect = (f: typeof folder): void => {
			if (f instanceof TFile && (f.extension === "md" || f.extension === "txt")) {
				files.push(f);
			} else if ("children" in f) {
				for (const child of (f as { children: typeof folder[] }).children) {
					collect(child);
				}
			}
		};
		collect(folder);
		return files;
	}

	getItemText(item: TFile): string {
		return item.path;
	}

	onChooseItem(item: TFile, _evt: MouseEvent | KeyboardEvent): void {
		this.onChoose(item);
	}
}

export class DiffViewModal extends FuzzySuggestModal<FileDiff> {
	private diffs: FileDiff[];
	private onApprove: (acceptedPaths: string[]) => void;

	constructor(app: App, diffs: FileDiff[], onApprove: (acceptedPaths: string[]) => void) {
		super(app);
		this.diffs = diffs;
		this.onApprove = onApprove;
		this.setPlaceholder("Review changes. Select to toggle, Enter to approve all.");
		this.setInstructions([
			{ command: "↵", purpose: "approve all changes" },
			{ command: "esc", purpose: "cancel" },
		]);
	}

	getItems(): FileDiff[] {
		return this.diffs;
	}

	getItemText(item: FileDiff): string {
		const prefix = item.isNew ? "[NEW]" : "[MOD]";
		return `${prefix} ${item.path} (+${item.summary.added} -${item.summary.deleted})`;
	}

	onChooseItem(_item: FileDiff, _evt: MouseEvent | KeyboardEvent): void {
		const allPaths = this.diffs.map((d) => d.path);
		this.onApprove(allPaths);
	}
}
