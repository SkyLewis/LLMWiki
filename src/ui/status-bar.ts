import { WorkspaceLeaf } from "obsidian";
import type { TokenCostEntry } from "../llm/model-router";

export interface StatusBarState {
	queueDepth: number;
	currentTask: string | null;
	pageCount: number;
	lastOperation: string | null;
	isActive: boolean;
}

export class StatusBar {
	private statusBarEl: HTMLElement;
	private state: StatusBarState = {
		queueDepth: 0,
		currentTask: null,
		pageCount: 0,
		lastOperation: null,
		isActive: false,
	};

	constructor(statusBarEl: HTMLElement) {
		this.statusBarEl = statusBarEl;
		this.statusBarEl.addClass("llm-wiki-status");
		this.render();
	}

	update(state: Partial<StatusBarState>): void {
		this.state = { ...this.state, ...state };
		this.render();
	}

	setActive(task: string): void {
		this.state.isActive = true;
		this.state.currentTask = task;
		this.render();
	}

	setIdle(): void {
		this.state.isActive = false;
		this.state.currentTask = null;
		this.render();
	}

	showCostTooltip(costSummary: Record<string, { inputTokens: number; outputTokens: number; count: number }>): void {
		const lines = Object.entries(costSummary)
			.filter(([, v]) => v.count > 0)
			.map(([tier, v]) => `${tier}: ${v.inputTokens + v.outputTokens} tokens (${v.count} calls)`)
			.join("\n");

		if (lines) {
			this.statusBarEl.setAttribute("aria-label", `Token usage:\n${lines}`);
			this.statusBarEl.addClass("has-tooltip");
		}
	}

	private render(): void {
		this.statusBarEl.empty();
		this.statusBarEl.toggleClass("active", this.state.isActive);

		// Status dot
		const dot = this.statusBarEl.createSpan({ cls: "status-dot" });

		// Text
		if (this.state.isActive && this.state.currentTask) {
			this.statusBarEl.createSpan({ text: `LLM Wiki: ${this.state.currentTask}` });
		} else if (this.state.queueDepth > 0) {
			this.statusBarEl.createSpan({ text: `LLM Wiki: ${this.state.queueDepth} queued` });
		} else {
			this.statusBarEl.createSpan({ text: `LLM Wiki` });
		}
	}
}
