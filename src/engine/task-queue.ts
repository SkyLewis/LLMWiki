import { App, TFile } from "obsidian";

export type TaskType = "ingest" | "query" | "lint" | "refactor" | "workflow";
export type TaskStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type ModelTier = "default" | "heavy_lift" | "lightweight" | "local_fallback";

export interface QueueTask {
	id: string;
	type: TaskType;
	status: TaskStatus;
	description: string;
	modelTier: ModelTier;
	progress: number;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	error?: string;
	checkpoint?: TaskCheckpoint;
}

export interface TaskCheckpoint {
	workflowId?: string;
	completedSteps: string[];
	stepOutputs: Record<string, unknown>;
	nextStepIndex: number;
}

type TaskEventHandler = (task: QueueTask) => void;

export class TaskQueue {
	private app: App;
	private queuePath: string;
	private queue: QueueTask[] = [];
	private currentTask: QueueTask | null = null;
	private abortController: AbortController | null = null;
	private handlers: { [K in TaskStatus]?: TaskEventHandler[] } = {};
	private running = false;

	constructor(app: App, llmWikiDir: string) {
		this.app = app;
		this.queuePath = `${llmWikiDir}/queue.json`;
	}

	/**
	 * Load persisted queue state
	 */
	async load(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.queuePath);
		if (file instanceof TFile) {
			try {
				const content = await this.app.vault.read(file);
				const data = JSON.parse(content);
				this.queue = data.queue ?? [];
				// Reset any running tasks to queued (they were interrupted)
				for (const task of this.queue) {
					if (task.status === "running") {
						task.status = "queued";
					}
				}
			} catch {
				this.queue = [];
			}
		}
	}

	/**
	 * Persist queue state
	 */
	async save(): Promise<void> {
		const data = { queue: this.queue, updatedAt: new Date().toISOString() };
		const file = this.app.vault.getAbstractFileByPath(this.queuePath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, JSON.stringify(data, null, 2));
		} else {
			try {
				await this.app.vault.create(this.queuePath, JSON.stringify(data, null, 2));
			} catch {
				// file was created by a concurrent process; modify it instead
				const f = this.app.vault.getAbstractFileByPath(this.queuePath);
				if (f instanceof TFile) {
					await this.app.vault.modify(f, JSON.stringify(data, null, 2));
				}
			}
		}
	}

	/**
	 * Add a task to the queue
	 */
	async enqueue(type: TaskType, description: string, modelTier: ModelTier = "default"): Promise<QueueTask> {
		const task: QueueTask = {
			id: crypto.randomUUID(),
			type,
			status: "queued",
			description,
			modelTier,
			progress: 0,
			createdAt: new Date().toISOString(),
		};

		this.queue.push(task);
		await this.save();
		this.emit(task);

		// Start processing if not already running
		if (!this.running) {
			this.processNext();
		}

		return task;
	}

	/**
	 * Cancel a queued task
	 */
	async cancel(taskId: string): Promise<boolean> {
		const task = this.queue.find((t) => t.id === taskId);
		if (!task) return false;

		if (task.status === "queued") {
			task.status = "cancelled";
			task.completedAt = new Date().toISOString();
			this.emit(task);
			await this.save();
			return true;
		}

		if (task.status === "running" && this.abortController) {
			this.abortController.abort();
			task.status = "cancelled";
			task.completedAt = new Date().toISOString();
			this.emit(task);
			await this.save();
			return true;
		}

		return false;
	}

	/**
	 * Get abort signal for current task
	 */
	getAbortSignal(): AbortSignal | null {
		return this.abortController?.signal ?? null;
	}

	/**
	 * Update task progress
	 */
	async updateProgress(taskId: string, progress: number): Promise<void> {
		const task = this.queue.find((t) => t.id === taskId);
		if (task) {
			task.progress = Math.min(100, Math.max(0, progress));
			this.emit(task);
		}
	}

	/**
	 * Update task checkpoint (for workflow resume)
	 */
	async updateCheckpoint(taskId: string, checkpoint: TaskCheckpoint): Promise<void> {
		const task = this.queue.find((t) => t.id === taskId);
		if (task) {
			task.checkpoint = checkpoint;
			await this.save();
		}
	}

	/**
	 * Register event handler
	 */
	on(status: TaskStatus, handler: TaskEventHandler): void {
		if (!this.handlers[status]) this.handlers[status] = [];
		this.handlers[status]!.push(handler);
	}

	/**
	 * Remove event handler
	 */
	off(status: TaskStatus, handler: TaskEventHandler): void {
		if (!this.handlers[status]) return;
		this.handlers[status] = this.handlers[status]!.filter((h) => h !== handler);
	}

	/**
	 * Get current queue state
	 */
	getQueue(): readonly QueueTask[] {
		return this.queue;
	}

	getCurrentTask(): QueueTask | null {
		return this.currentTask;
	}

	getQueueDepth(): number {
		return this.queue.filter((t) => t.status === "queued").length;
	}

	/**
	 * Mark task as done (called by the engine that executes the task)
	 */
	async markDone(taskId: string): Promise<void> {
		const task = this.queue.find((t) => t.id === taskId);
		if (task) {
			task.status = "done";
			task.progress = 100;
			task.completedAt = new Date().toISOString();
			this.emit(task);
			this.currentTask = null;
			await this.save();
			await this.processNext();
		}
	}

	/**
	 * Mark task as failed
	 */
	async markFailed(taskId: string, error: string): Promise<void> {
		const task = this.queue.find((t) => t.id === taskId);
		if (task) {
			task.status = "failed";
			task.error = error;
			task.completedAt = new Date().toISOString();
			this.emit(task);
			this.currentTask = null;
			await this.save();
			await this.processNext();
		}
	}

	/**
	 * Clean up old completed/failed tasks
	 */
	async cleanup(maxAge: number = 24 * 60 * 60 * 1000): Promise<void> {
		const cutoff = Date.now() - maxAge;
		this.queue = this.queue.filter((t) => {
			if (t.status === "done" || t.status === "failed" || t.status === "cancelled") {
				const completedAt = t.completedAt ? new Date(t.completedAt).getTime() : 0;
				return completedAt > cutoff;
			}
			return true;
		});
		await this.save();
	}

	private processNext(): void {
		if (this.running) return;

		const next = this.queue.find((t) => t.status === "queued");
		if (!next) {
			this.running = false;
			return;
		}

		this.running = true;
		this.currentTask = next;
		this.abortController = new AbortController();
		next.status = "running";
		next.startedAt = new Date().toISOString();
		this.emit(next);
		this.save();
	}

	private emit(task: QueueTask): void {
		const handlers = this.handlers[task.status];
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(task);
				} catch {
					// swallow handler errors
				}
			}
		}
	}
}
