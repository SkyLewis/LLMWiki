import { LLMProvider, LLMMessage, LLMCompleteOptions, LLMStreamOptions, LLMCompleteResult, LLMEmbedResult, LLMConfig } from "./provider";

export class OllamaProvider extends LLMProvider {
	readonly name = "ollama";
	private baseUrl: string;
	private config: LLMConfig;

	constructor(config: LLMConfig) {
		super();
		this.config = config;
		this.baseUrl = config.baseUrl ?? "http://localhost:11434";
	}

	async test(): Promise<{ ok: boolean; error?: string; model?: string }> {
		try {
			const response = await fetch(`${this.baseUrl}/api/tags`, { method: "GET" });
			if (!response.ok) {
				return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
			}
			return { ok: true, model: this.config.model };
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, error: msg };
		}
	}

	async complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<LLMCompleteResult> {
		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.config.model,
				messages: messages.map((m) => ({
					role: m.role,
					content: m.content,
				})),
				stream: false,
				options: {
					temperature: options?.temperature ?? this.config.temperature ?? 0.3,
					num_predict: options?.maxTokens ?? this.config.maxTokens ?? 4096,
				},
				format: options?.jsonMode ? "json" : undefined,
			}),
			signal: options?.abortSignal,
		});

		if (!response.ok) {
			throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
		}

		const data = await response.json();
		return {
			text: data.message?.content ?? "",
			usage: {
				inputTokens: data.prompt_eval_count ?? 0,
				outputTokens: data.eval_count ?? 0,
			},
			model: data.model ?? this.config.model,
		};
	}

	async stream(messages: LLMMessage[], options: LLMStreamOptions): Promise<LLMCompleteResult> {
		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: this.config.model,
				messages: messages.map((m) => ({
					role: m.role,
					content: m.content,
				})),
				stream: true,
				options: {
					temperature: options.temperature ?? this.config.temperature ?? 0.3,
					num_predict: options.maxTokens ?? this.config.maxTokens ?? 4096,
				},
			}),
			signal: options.abortSignal,
		});

		if (!response.ok) {
			throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
		}

		const reader = response.body?.getReader();
		if (!reader) throw new Error("No response body");

		const decoder = new TextDecoder();
		let fullText = "";
		let inputTokens = 0;
		let outputTokens = 0;

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const chunk = decoder.decode(value, { stream: true });
			for (const line of chunk.split("\n")) {
				if (!line.trim()) continue;
				try {
					const data = JSON.parse(line);
					if (data.message?.content) {
						fullText += data.message.content;
						options.onChunk(data.message.content);
					}
					if (data.prompt_eval_count) inputTokens = data.prompt_eval_count;
					if (data.eval_count) outputTokens += data.eval_count;
				} catch {
					// skip incomplete JSON lines
				}
			}
		}

		return {
			text: fullText,
			usage: { inputTokens, outputTokens },
			model: this.config.model,
		};
	}

	async embed(texts: string[], abortSignal?: AbortSignal): Promise<LLMEmbedResult> {
		const embeddings: number[][] = [];
		let totalTokens = 0;

		for (const text of texts) {
			const response = await fetch(`${this.baseUrl}/api/embeddings`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: this.config.model,
					prompt: text,
				}),
				signal: abortSignal,
			});

			if (!response.ok) {
				throw new Error(`Ollama embed error: ${response.status}`);
			}

			const data = await response.json();
			embeddings.push(data.embedding);
			totalTokens += data.prompt_eval_count ?? 0;
		}

		return {
			embeddings,
			usage: { inputTokens: totalTokens },
		};
	}
}
