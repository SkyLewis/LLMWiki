import { App, Modal } from "obsidian";
import type LLMWikiPlugin from "../main";
import { LintReport, SchemaProposal } from "../wiki/lint";

export class LintViewModal extends Modal {
	private plugin: LLMWikiPlugin;
	private report: LintReport;
	private onAction: (action: string, details?: Record<string, unknown>) => void;

	constructor(
		app: App,
		plugin: LLMWikiPlugin,
		report: LintReport,
		onAction: (action: string, details?: Record<string, unknown>) => void
	) {
		super(app);
		this.plugin = plugin;
		this.report = report;
		this.onAction = onAction;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("llm-wiki-lint-view");
		contentEl.createEl("h2", { text: "Wiki Lint Report" });

		// Summary
		const summaryEl = contentEl.createDiv();
		summaryEl.style.cssText = "margin-bottom: 16px;";
		summaryEl.createSpan({ text: `${this.report.totalPages} pages scanned, ${this.report.issues.length} issues found` });

		// Issues by type
		const types: Record<string, { icon: string; label: string }> = {
			orphan: { icon: "🔗", label: "Orphan Pages" },
			broken_reference: { icon: "❌", label: "Broken References" },
			contradiction: { icon: "⚠️", label: "Contradictions" },
			stale: { icon: "🕐", label: "Stale Content" },
			missing_page: { icon: "📄", label: "Missing Pages" },
			refactoring_candidate: { icon: "📦", label: "Refactoring Candidates" },
			dangling_edge: { icon: "🔀", label: "Dangling Graph Edges" },
		};

		for (const [type, config] of Object.entries(types)) {
			const issues = this.report.issues.filter((i) => i.type === type);
			if (issues.length === 0) continue;

			const group = contentEl.createDiv({ cls: "issue-group" });
			group.createDiv({ cls: "issue-group-header", text: `${config.icon} ${config.label} (${issues.length})` });

			for (const issue of issues) {
				const item = group.createDiv({ cls: "issue-item" });

				item.createSpan({ cls: "issue-icon", text: config.icon });

				if (issue.path) {
					const pathEl = item.createSpan({ cls: "issue-path", text: issue.path });
					pathEl.addEventListener("click", () => {
						const file = this.app.vault.getAbstractFileByPath(issue.path!);
						if (file) {
							this.app.workspace.getLeaf(false).openFile(file as any);
						}
					});
				}

				item.createSpan({ cls: "issue-desc", text: issue.description });

				// Action buttons for refactoring candidates
				if (issue.type === "refactoring_candidate" && issue.path) {
					const refactorBtn = item.createEl("button", { text: "Refactor", cls: "mod-cta" });
					refactorBtn.style.cssText = "font-size: 11px; padding: 2px 8px;";
					refactorBtn.addEventListener("click", () => {
						this.onAction("refactor", { path: issue.path });
					});
				}
			}
		}

		// Schema proposals
		if (this.report.schemaProposals.length > 0) {
			const schemaGroup = contentEl.createDiv({ cls: "issue-group" });
			schemaGroup.createDiv({ cls: "issue-group-header", text: `📋 Schema Amendment Proposals (${this.report.schemaProposals.length})` });

			for (const proposal of this.report.schemaProposals) {
				const item = schemaGroup.createDiv({ cls: "schema-proposal" });
				item.createEl("strong", { text: `${proposal.category}: "${proposal.section}"` });
				item.createDiv({ text: `Prevalence: ${proposal.prevalence}` });
				item.createDiv({ text: `Proposal: ${proposal.proposal}` });

				const btnRow = item.createDiv({ cls: "modal-button-container" });
				btnRow.style.cssText = "display: flex; gap: 8px; margin-top: 8px;";

				btnRow.createEl("button", { text: "Approve" }).addEventListener("click", () => {
					this.onAction("approve_schema", proposal as unknown as Record<string, unknown>);
				});

				btnRow.createEl("button", { text: "Reject" }).addEventListener("click", () => {
					this.onAction("reject_schema", proposal as unknown as Record<string, unknown>);
				});
			}
		}

		// Cleanup dangling edges button
		const danglingCount = this.report.issues.filter((i) => i.type === "dangling_edge").length;
		if (danglingCount > 0) {
			const cleanupBtn = contentEl.createEl("button", { text: `Clean up ${danglingCount} dangling edge(s)` });
			cleanupBtn.style.cssText = "margin-top: 16px;";
			cleanupBtn.addEventListener("click", () => {
				this.onAction("cleanup_edges");
			});
		}

		// Close button
		contentEl.createEl("button", { text: "Close" }).addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
