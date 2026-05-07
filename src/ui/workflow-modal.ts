import { App, Modal, TextAreaComponent } from "obsidian";
import type LLMWikiPlugin from "../main";
import { WorkflowIntent, WorkflowResult } from "../wiki/workflows";

const WORKFLOW_INTENTS: { id: WorkflowIntent; name: string; description: string }[] = [
	{
		id: "deep_explore",
		name: "Deep Explore",
		description: "Explore a concept deeply — query wiki, extract claims, cross-compare sources, identify gaps",
	},
	{
		id: "verify_claim",
		name: "Verify Claim",
		description: "Locate a claim in wiki, trace to sources, compare summary vs raw, flag distortions",
	},
	{
		id: "trace_contradiction",
		name: "Trace Contradiction",
		description: "Find contradiction annotations, traverse graph, map conflicting sources, produce divergence report",
	},
	{
		id: "comprehensive_review",
		name: "Comprehensive Review",
		description: "Full wiki query, extract claims, cross-compare all sources, scan for omissions and distortions",
	},
];

export class WorkflowModal extends Modal {
	private plugin: LLMWikiPlugin;
	private selectedIntent: WorkflowIntent | null = null;
	private inputText = "";
	private onSubmit: (intent: WorkflowIntent, input: string) => void;

	constructor(app: App, plugin: LLMWikiPlugin, onSubmit: (intent: WorkflowIntent, input: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("llm-wiki-workflow-modal");
		contentEl.createEl("h2", { text: "Workflow Launcher" });

		// Intent selector
		const intentList = contentEl.createDiv({ cls: "intent-list" });

		for (const intent of WORKFLOW_INTENTS) {
			const item = intentList.createDiv({ cls: "intent-item" });
			item.createDiv({ cls: "intent-name", text: intent.name });
			item.createDiv({ cls: "intent-desc", text: intent.description });

			item.addEventListener("click", () => {
				// Deselect all
				intentList.querySelectorAll(".intent-item").forEach((el) => {
					(el as HTMLElement).style.borderColor = "";
				});
				// Select this one
				item.style.borderColor = "var(--text-accent)";
				this.selectedIntent = intent.id;
			});
		}

		// Input area
		contentEl.createEl("h3", { text: "What would you like to explore?" });

		new TextAreaComponent(contentEl)
			.setPlaceholder("Enter a concept, claim, or question...")
			.onChange((value) => {
				this.inputText = value;
			})
			.inputEl.style.cssText = "width: 100%; height: 60px; resize: vertical;";

		// Action buttons
		const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });
		btnContainer.style.cssText = "display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end;";

		btnContainer.createEl("button", { text: "Cancel" }).addEventListener("click", () => {
			this.close();
		});

		btnContainer.createEl("button", { text: "Start Workflow", cls: "mod-cta" }).addEventListener("click", () => {
			if (this.selectedIntent && this.inputText.trim()) {
				this.onSubmit(this.selectedIntent, this.inputText.trim());
				this.close();
			}
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

export class WorkflowResultModal extends Modal {
	private result: WorkflowResult;

	constructor(app: App, result: WorkflowResult) {
		super(app);
		this.result = result;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: `Workflow: ${this.result.intent.replace(/_/g, " ")}` });

		// Steps completed
		contentEl.createEl("h3", { text: "Steps Completed" });
		const stepsList = contentEl.createEl("ul");
		for (const step of this.result.stepsCompleted) {
			stepsList.createEl("li", { text: step.replace(/_/g, " ") });
		}

		// Findings
		if (this.result.findings.length > 0) {
			contentEl.createEl("h3", { text: "Findings" });
			const findingsEl = contentEl.createDiv();
			findingsEl.style.cssText = "max-height: 300px; overflow-y: auto; padding: 8px; border: 1px solid var(--background-modifier-border); border-radius: 4px;";
			for (const finding of this.result.findings) {
				findingsEl.createDiv({ text: finding, attr: { style: "margin-bottom: 8px;" } });
			}
		}

		// Suggested actions
		if (this.result.suggestedActions.length > 0) {
			contentEl.createEl("h3", { text: "Suggested Actions" });
			const actionsList = contentEl.createEl("ul");
			for (const action of this.result.suggestedActions) {
				actionsList.createEl("li", { text: `[${action.type}] ${action.description}` });
			}
		}

		contentEl.createEl("button", { text: "Close" }).addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
