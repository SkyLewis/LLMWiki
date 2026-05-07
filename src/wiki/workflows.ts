import { App, TFile } from "obsidian";
import { ModelRouter, TaskType } from "../llm/model-router";
import { PromptBuilder } from "../llm/prompt-builder";
import { LLMMessage } from "../llm/provider";
import { QueryEngine, QueryResult } from "./query";
import { GraphIndex } from "./graph-index";
import { TaskQueue, TaskCheckpoint } from "../engine/task-queue";
import type { LLMWikiSettings } from "../ui/settings-tab";

export type WorkflowIntent =
	| "deep_explore"
	| "verify_claim"
	| "trace_contradiction"
	| "comprehensive_review";

export interface WorkflowStep {
	id: string;
	name: string;
	description: string;
	execute: (context: WorkflowContext) => Promise<WorkflowStepResult>;
}

export interface WorkflowStepResult {
	data: Record<string, unknown>;
	nextAction?: "continue" | "branch" | "stop";
	branchTo?: string;
	suggestedActions: SuggestedAction[];
}

export interface SuggestedAction {
	type: "ingest" | "query" | "edit" | "create_page";
	description: string;
	details?: Record<string, unknown>;
}

export interface WorkflowContext {
	intent: WorkflowIntent;
	input: string;
	stepsCompleted: string[];
	stepOutputs: Record<string, Record<string, unknown>>;
	queueTaskId: string;
}

export interface WorkflowResult {
	intent: WorkflowIntent;
	input: string;
	stepsCompleted: string[];
	findings: string[];
	suggestedActions: SuggestedAction[];
}

export class WorkflowEngine {
	private app: App;
	private settings: LLMWikiSettings;
	private modelRouter: ModelRouter;
	private promptBuilder: PromptBuilder;
	private queryEngine: QueryEngine;
	private graphIndex: GraphIndex;
	private taskQueue: TaskQueue;

	constructor(
		app: App,
		settings: LLMWikiSettings,
		modelRouter: ModelRouter,
		promptBuilder: PromptBuilder,
		queryEngine: QueryEngine,
		graphIndex: GraphIndex,
		taskQueue: TaskQueue
	) {
		this.app = app;
		this.settings = settings;
		this.modelRouter = modelRouter;
		this.promptBuilder = promptBuilder;
		this.queryEngine = queryEngine;
		this.graphIndex = graphIndex;
		this.taskQueue = taskQueue;
	}

	/**
	 * Get built-in workflow steps for a given intent
	 */
	getWorkflow(intent: WorkflowIntent): WorkflowStep[] {
		switch (intent) {
			case "deep_explore":
				return this.deepExploreWorkflow();
			case "verify_claim":
				return this.verifyClaimWorkflow();
			case "trace_contradiction":
				return this.traceContradictionWorkflow();
			case "comprehensive_review":
				return this.comprehensiveReviewWorkflow();
		}
	}

	/**
	 * Execute a workflow step by step
	 */
	async execute(
		intent: WorkflowIntent,
		input: string,
		abortSignal?: AbortSignal
	): Promise<WorkflowResult> {
		const steps = this.getWorkflow(intent);
		const context: WorkflowContext = {
			intent,
			input,
			stepsCompleted: [],
			stepOutputs: {},
			queueTaskId: "",
		};

		const allFindings: string[] = [];
		const allSuggestedActions: SuggestedAction[] = [];

		for (const step of steps) {
			if (abortSignal?.aborted) break;

			try {
				const result = await step.execute(context);

				context.stepsCompleted.push(step.id);
				context.stepOutputs[step.id] = result.data;

				allFindings.push(
					...Object.values(result.data)
						.filter((v): v is string => typeof v === "string")
				);
				allSuggestedActions.push(...result.suggestedActions);

				// Update checkpoint for resume
				const checkpoint: TaskCheckpoint = {
					workflowId: intent,
					completedSteps: context.stepsCompleted,
					stepOutputs: context.stepOutputs,
					nextStepIndex: steps.indexOf(step) + 1,
				};
				// Note: taskQueue.updateCheckpoint would be called with the actual task ID

				if (result.nextAction === "stop") break;
				if (result.nextAction === "branch" && result.branchTo) {
					const branchStep = steps.find((s) => s.id === result.branchTo);
					if (branchStep) {
						const branchResult = await branchStep.execute(context);
						context.stepsCompleted.push(branchStep.id);
						context.stepOutputs[branchStep.id] = branchResult.data;
						allSuggestedActions.push(...branchResult.suggestedActions);
					}
					break;
				}
			} catch (error) {
				allFindings.push(`Step "${step.name}" failed: ${error}`);
				break;
			}
		}

		return {
			intent,
			input,
			stepsCompleted: context.stepsCompleted,
			findings: allFindings,
			suggestedActions: allSuggestedActions,
		};
	}

	/**
	 * Resume a workflow from a checkpoint
	 */
	async resume(
		intent: WorkflowIntent,
		input: string,
		checkpoint: TaskCheckpoint,
		abortSignal?: AbortSignal
	): Promise<WorkflowResult> {
		const steps = this.getWorkflow(intent);
		const context: WorkflowContext = {
			intent,
			input,
			stepsCompleted: checkpoint.completedSteps,
			stepOutputs: checkpoint.stepOutputs as Record<string, Record<string, unknown>>,
			queueTaskId: "",
		};

		const allFindings: string[] = [];
		const allSuggestedActions: SuggestedAction[] = [];

		// Skip completed steps, resume from nextStepIndex
		for (let i = checkpoint.nextStepIndex; i < steps.length; i++) {
			if (abortSignal?.aborted) break;

			const step = steps[i];
			try {
				const result = await step.execute(context);
				context.stepsCompleted.push(step.id);
				context.stepOutputs[step.id] = result.data;
				allSuggestedActions.push(...result.suggestedActions);

				if (result.nextAction === "stop") break;
			} catch (error) {
				allFindings.push(`Step "${step.name}" failed: ${error}`);
				break;
			}
		}

		return {
			intent,
			input,
			stepsCompleted: context.stepsCompleted,
			findings: allFindings,
			suggestedActions: allSuggestedActions,
		};
	}

	private deepExploreWorkflow(): WorkflowStep[] {
		return [
			{
				id: "query",
				name: "Query wiki for topic",
				description: "Search the wiki for existing knowledge about the topic",
				execute: async (ctx) => {
					const result = await this.queryEngine.query(ctx.input);
					return {
						data: { summary: result.answer, sourcePages: result.sourcePages },
						suggestedActions: [],
					};
				},
			},
			{
				id: "extract_claims",
				name: "Extract key claims",
				description: "Extract the main claims from the query results",
				execute: async (ctx) => {
					const summary = ctx.stepOutputs["query"]?.summary as string ?? "";
					const { provider, tier } = this.modelRouter.resolve("workflow-step");

					const result = await provider.complete([
						{ role: "user", content: `Extract the key factual claims from this text. Return as a JSON array of strings.\n\n${summary}` },
					], { jsonMode: true });

					this.modelRouter.recordCost({
						tier, taskType: "workflow-step",
						inputTokens: result.usage.inputTokens,
						outputTokens: result.usage.outputTokens,
						timestamp: Date.now(),
					});

					const claims = JSON.parse(result.text);
					return {
						data: { claims },
						suggestedActions: [],
					};
				},
			},
			{
				id: "identify_gaps",
				name: "Identify knowledge gaps",
				description: "Compare claims against wiki sources to find gaps",
				execute: async (ctx) => {
					const claims = ctx.stepOutputs["extract_claims"]?.claims as string[] ?? [];
					const { provider, tier } = this.modelRouter.resolve("workflow-step");

					const result = await provider.complete([
						{ role: "user", content: `Given these claims from a wiki query, identify which ones lack sufficient supporting evidence and suggest sources that could fill the gaps.\n\nClaims: ${JSON.stringify(claims)}` },
					]);

					this.modelRouter.recordCost({
						tier, taskType: "workflow-step",
						inputTokens: result.usage.inputTokens,
						outputTokens: result.usage.outputTokens,
						timestamp: Date.now(),
					});

					return {
						data: { gaps: result.text },
						suggestedActions: [
							{ type: "ingest", description: "Ingest sources to fill identified knowledge gaps" },
						],
					};
				},
			},
		];
	}

	private verifyClaimWorkflow(): WorkflowStep[] {
		return [
			{
				id: "locate",
				name: "Locate claim in wiki",
				description: "Find the claim in the wiki",
				execute: async (ctx) => {
					const result = await this.queryEngine.query(ctx.input);
					return {
						data: { found: result.answer, sourcePages: result.sourcePages },
						suggestedActions: [],
					};
				},
			},
			{
				id: "trace",
				name: "Trace to source pages",
				description: "Follow wiki-links back to source pages",
				execute: async (ctx) => {
					const sourcePages = ctx.stepOutputs["locate"]?.sourcePages as string[] ?? [];
					const sources: { path: string; content: string }[] = [];

					for (const path of sourcePages) {
						const file = this.app.vault.getAbstractFileByPath(`${path}.md`);
						if (file instanceof TFile) {
							const content = await this.app.vault.read(file);
							sources.push({ path, content: content.substring(0, 2000) });
						}
					}

					return { data: { sources }, suggestedActions: [] };
				},
			},
			{
				id: "compare",
				name: "Compare wiki summary vs raw sources",
				description: "Check for distortions or omissions",
				execute: async (ctx) => {
					const found = ctx.stepOutputs["locate"]?.found as string ?? "";
					const sources = ctx.stepOutputs["trace"]?.sources as { path: string; content: string }[] ?? [];

					const { provider, tier } = this.modelRouter.resolve("workflow-step");
					const result = await provider.complete([
						{
							role: "user",
							content: `Compare the wiki summary against the raw source content. Flag any distortions, omissions, or misrepresentations.\n\nWiki summary:\n${found}\n\nSources:\n${sources.map((s) => s.content).join("\n---\n")}`,
						},
					]);

					this.modelRouter.recordCost({
						tier, taskType: "workflow-step",
						inputTokens: result.usage.inputTokens,
						outputTokens: result.usage.outputTokens,
						timestamp: Date.now(),
					});

					return {
						data: { analysis: result.text },
						suggestedActions: [
							{ type: "edit", description: "Fix any identified distortions in wiki pages" },
						],
					};
				},
			},
		];
	}

	private traceContradictionWorkflow(): WorkflowStep[] {
		return [
			{
				id: "find_contradictions",
				name: "Find contradiction annotations",
				description: "Search wiki for contradiction markers",
				execute: async (ctx) => {
					const result = await this.queryEngine.query(`contradiction ${ctx.input}`);
					return {
						data: { contradictions: result.answer, sourcePages: result.sourcePages },
						suggestedActions: [],
					};
				},
			},
			{
				id: "traverse_graph",
				name: "Traverse graph for conflicting sources",
				description: "Use graph traversal to map related conflicting sources",
				execute: async (ctx) => {
					const sourcePages = ctx.stepOutputs["find_contradictions"]?.sourcePages as string[] ?? [];
					const slugs = sourcePages.map((p) => {
						const parts = p.split("/");
						return parts[parts.length - 1];
					});

					const related = this.graphIndex.traverse(slugs, 2);
					const contradictsEdges = this.graphIndex.getEdgesByType("contradicts");

					const relevantEdges = contradictsEdges.filter(
						(e) => slugs.includes(e.from) || slugs.includes(e.to)
					);

					return {
						data: { relatedNodes: related, contradictionEdges: relevantEdges },
						suggestedActions: [],
					};
				},
			},
			{
				id: "report",
				name: "Generate divergence report",
				description: "Produce a structured divergence report",
				execute: async (ctx) => {
					const contradictions = ctx.stepOutputs["find_contradictions"]?.contradictions as string ?? "";
					const edges = ctx.stepOutputs["traverse_graph"]?.contradictionEdges as { from: string; to: string; rel: string }[] ?? [];

					const { provider, tier } = this.modelRouter.resolve("workflow-step");
					const result = await provider.complete([
						{
							role: "user",
							content: `Based on this contradiction information, generate a structured divergence report:\n\nContradictions found:\n${contradictions}\n\nGraph edges:\n${JSON.stringify(edges)}`,
						},
					]);

					this.modelRouter.recordCost({
						tier, taskType: "workflow-step",
						inputTokens: result.usage.inputTokens,
						outputTokens: result.usage.outputTokens,
						timestamp: Date.now(),
					});

					return {
						data: { report: result.text },
						suggestedActions: [
							{ type: "edit", description: "Update contradiction annotations based on findings" },
						],
					};
				},
			},
		];
	}

	private comprehensiveReviewWorkflow(): WorkflowStep[] {
		return [
			{
				id: "full_query",
				name: "Full wiki query",
				description: "Query the wiki broadly for the topic",
				execute: async (ctx) => {
					const result = await this.queryEngine.query(ctx.input);
					return {
						data: { summary: result.answer, sourcePages: result.sourcePages },
						suggestedActions: [],
					};
				},
			},
			{
				id: "scan_omissions",
				name: "Scan for omissions and distortions",
				description: "Cross-compare claims against all sources",
				execute: async (ctx) => {
					const summary = ctx.stepOutputs["full_query"]?.summary as string ?? "";
					const { provider, tier } = this.modelRouter.resolve("schema-evolve");

					const result = await provider.complete([
						{
							role: "user",
							content: `Review this wiki summary for omissions, distortions, and gaps. Suggest what sources should be ingested to fill the gaps.\n\n${summary}`,
						},
					]);

					this.modelRouter.recordCost({
						tier, taskType: "schema-evolve",
						inputTokens: result.usage.inputTokens,
						outputTokens: result.usage.outputTokens,
						timestamp: Date.now(),
					});

					return {
						data: { review: result.text },
						suggestedActions: [
							{ type: "ingest", description: "Ingest suggested sources to fill gaps" },
							{ type: "edit", description: "Fix identified distortions" },
						],
					};
				},
			},
		];
	}
}
