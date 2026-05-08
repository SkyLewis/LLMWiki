import { LLMProvider, LLMMessage, LLMCompleteOptions, LLMStreamOptions, LLMCompleteResult, LLMEmbedResult, LLMConfig } from "./provider";

export class OpenAICompatProvider extends LLMProvider {
	readonly name = "openai_compat";
	private config: LLMConfig;

	constructor(config: LLMConfig) {
		super();
		this.config = config;
	}

	private get baseUrl(): string {
		return this.config.baseUrl ?? "https://api.openai.com/v1";
	}

	private get headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.config.authMethod === "authToken") {
			headers["Authorization"] = `Bearer ${this.config.apiKey ?? ""}`;
		} else {
			headers["X-Api-Key"] = this.config.apiKey ?? "";
		}
		return headers;
	}

	async test(): Promise<{ ok: boolean; error?: string; model?: string }> {
		try {
			const response = await fetch(`${this.baseUrl}/models`, {
				method: "GET",
				headers: {
					"Authorization": `Bearer ${this.config.apiKey ?? ""}`,
				},
			});
			if (!response.ok) {
				const err = await response.text();
				return { ok: false, error: `HTTP ${response.status}: ${err}` };
			}
			return { ok: true, model: this.config.model };
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, error: msg };
		}
	}

	async complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<LLMCompleteResult> {
		const body: Record<string, unknown> = {
			model: this.config.model,
			messages: messages.map((m) => ({
				role: m.role as "system" | "user" | "assistant",
				content: m.content,
			})),
		};
		const maxTokens = options?.maxTokens ?? this.config.maxTokens;
		if (maxTokens !== undefined) body["max_tokens"] = maxTokens;
		const temperature = options?.temperature ?? this.config.temperature ?? 0.3;
		if (temperature !== undefined) body["temperature"] = temperature;
		if (options?.stopSequences) body["stop"] = options.stopSequences;
		if (options?.jsonMode) body["response_format"] = { type: "json_object" };

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(body),
			signal: options?.abortSignal,
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`OpenAI Compat API error ${response.status}: ${err}`);
		}

		const data = await response.json();
		return {
			text: data.choices?.[0]?.message?.content ?? "",
			usage: {
				inputTokens: data.usage?.prompt_tokens ?? 0,
				outputTokens: data.usage?.completion_tokens ?? 0,
			},
			model: data.model ?? this.config.model,
		};
	}

	async stream(messages: LLMMessage[], options: LLMStreamOptions): Promise<LLMCompleteResult> {
		const body: Record<string, unknown> = {
			model: this.config.model,
			messages: messages.map((m) => ({
				role: m.role as "system" | "user" | "assistant",
				content: m.content,
			})),
			stream: true,
		};
		const maxTokens = options.maxTokens ?? this.config.maxTokens;
		if (maxTokens !== undefined) body["max_tokens"] = maxTokens;
		const temperature = options.temperature ?? this.config.temperature ?? 0.3;
		if (temperature !== undefined) body["temperature"] = temperature;
		if (options.stopSequences) body["stop"] = options.stopSequences;
		if (options.jsonMode) body["response_format"] = { type: "json_object" };

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(body),
			signal: options.abortSignal,
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`OpenAI Compat API error ${response.status}: ${err}`);
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
				if (!line.trim() || !line.startsWith("data: ")) continue;
				const text = line.slice(6);
				if (text === "[DONE]") break;
				try {
					const data = JSON.parse(text);
					const delta = data.choices?.[0]?.delta?.content ?? "";
					if (delta) {
						fullText += delta;
						options.onChunk(delta);
					}
					if (data.usage) {
						inputTokens = data.usage.prompt_tokens ?? 0;
						outputTokens = data.usage.completion_tokens ?? 0;
					}
				} catch {
					// skip malformed lines
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
		const base = this.baseUrl.replace(/\/v1$/, "");
		const response = await fetch(`${base}/embeddings`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify({
				model: "text-embedding-3-small",
				input: texts,
			}),
			signal: abortSignal,
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`OpenAI Compat embed error ${response.status}: ${err}`);
		}

		const data = await response.json();
		return {
			embeddings: data.data?.map((d: { embedding: number[] }) => d.embedding) ?? [],
			usage: { inputTokens: data.usage?.prompt_tokens ?? 0 },
		};
	}
}
