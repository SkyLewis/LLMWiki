import { App, Modal, TextAreaComponent } from "obsidian";
import type LLMWikiPlugin from "../main";
import { QueryResult } from "../wiki/query";

export class QueryModal extends Modal {
	private plugin: LLMWikiPlugin;
	private onSubmit: (query: string) => void;

	constructor(app: App, plugin: LLMWikiPlugin, onSubmit: (query: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("llm-wiki-query-modal");
		contentEl.createEl("h2", { text: "Query Wiki" });

		const inputContainer = contentEl.createDiv();
		let queryText = "";

		new TextAreaComponent(inputContainer)
			.setPlaceholder("Ask a question about your wiki...")
			.onChange((value) => {
				queryText = value;
			})
			.inputEl.style.cssText = "width: 100%; height: 80px; resize: vertical;";

		const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });
		btnContainer.style.cssText = "display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end;";

		btnContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
			this.close();
		});

		btnContainer.createEl("button", { text: "Query", cls: "mod-cta" }).addEventListener("click", () => {
			if (queryText.trim()) {
				this.onSubmit(queryText.trim());
				this.close();
			}
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class QueryResultModal extends Modal {
	private result: QueryResult;
	private onFileAsPage: () => void;

	constructor(app: App, result: QueryResult, onFileAsPage: () => void) {
		super(app);
		this.result = result;
		this.onFileAsPage = onFileAsPage;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("llm-wiki-query-modal");
		contentEl.createEl("h2", { text: "Query Result" });

		const answerContainer = contentEl.createDiv({ cls: "answer-container" });

		// Render answer with clickable wiki-links
		const answerText = this.result.answer;
		const parts = answerText.split(/(\[\[[^\]]+\]\])/g);
		for (const part of parts) {
			const linkMatch = part.match(/^\[\[([^\]]+)\]\]$/);
			if (linkMatch) {
				const link = answerContainer.createEl("a", {
					cls: "wiki-link",
					text: linkMatch[1],
				});
				link.addEventListener("click", () => {
					// Navigate to the wiki page
					const file = this.app.vault.getAbstractFileByPath(`wiki/${linkMatch[1]}.md`);
					if (file) {
						this.app.workspace.getLeaf(false).openFile(file as any);
					}
				});
			} else {
				answerContainer.createSpan({ text: part });
			}
		}

		// Source pages info
		const metaEl = contentEl.createDiv({ cls: "query-meta" });
		metaEl.style.cssText = "margin-top: 12px; font-size: 12px; color: var(--text-muted);";
		const flags: string[] = [];
		if (this.result.usedSemanticSearch) flags.push("semantic");
		if (this.result.usedGraphTraversal) flags.push("graph");
		metaEl.setText(`Sources: ${this.result.sourcePages.length} pages${flags.length ? ` (${flags.join(" + ")})` : ""}`);

		// File as wiki page button
		const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });
		btnContainer.style.cssText = "display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end;";

		btnContainer.createEl("button", { text: "Close" }).addEventListener("click", () => {
			this.close();
		});

		btnContainer.createEl("button", { text: "File as Wiki Page", cls: "mod-cta" }).addEventListener("click", () => {
			this.onFileAsPage();
			this.close();
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
