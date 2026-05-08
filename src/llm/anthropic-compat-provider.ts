import { LLMProvider, LLMMessage, LLMCompleteOptions, LLMStreamOptions, LLMCompleteResult, LLMConfig } from "./provider";

export class AnthropicCompatProvider extends LLMProvider {
	readonly name = "anthropic_compat";
	private config: LLMConfig;

	constructor(config: LLMConfig) {
		super();
		this.config = config;
	}

	private get baseUrl(): string {
		return this.config.baseUrl ?? "https://api.anthropic.com/v1";
	}

	private get isOfficialAnthropic(): boolean {
		return !this.config.baseUrl;
	}

	private get headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (this.isOfficialAnthropic) {
			headers["anthropic-version"] = "2023-06-01";
		}
		if (this.config.authMethod === "authToken") {
			headers["Authorization"] = `Bearer ${this.config.apiKey ?? ""}`;
		} else {
			headers["x-api-key"] = this.config.apiKey ?? "";
		}
		return headers;
	}

	async test(): Promise<{ ok: boolean; error?: string; model?: string }> {
		try {
			const response = await fetch(`${this.baseUrl}/messages`, {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify({
					model: this.config.model,
					max_tokens: 1,
					messages: [{ role: "user", content: "hi" }],
				}),
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
		const systemMsg = messages.find((m) => m.role === "system");
		const nonSystemMsgs = messages.filter((m) => m.role !== "system");

		const body: Record<string, unknown> = {
			model: this.config.model,
			messages: nonSystemMsgs.map((m) => ({
				role: m.role as "user" | "assistant",
				content: m.content,
			})),
		};
		const maxTokens = options?.maxTokens ?? this.config.maxTokens;
		if (maxTokens !== undefined) body["max_tokens"] = maxTokens;
		const temperature = options?.temperature ?? this.config.temperature ?? 0.3;
		if (temperature !== undefined) body["temperature"] = temperature;
		if (systemMsg) body["system"] = systemMsg.content;
		if (options?.stopSequences) body["stop_sequences"] = options.stopSequences;

		const response = await fetch(`${this.baseUrl}/messages`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(body),
			signal: options?.abortSignal,
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`Anthropic Compat API error ${response.status}: ${err}`);
		}

		const data = await response.json();
		const text = typeof data.content === "string"
			? data.content
			: Array.isArray(data.content)
				? (data.content.find((c: { type: string }) => c.type === "text") as { text?: string })?.text ?? ""
				: "";

		return {
			text,
			usage: {
				inputTokens: data.usage?.input_tokens ?? 0,
				outputTokens: data.usage?.output_tokens ?? 0,
			},
			model: data.model ?? this.config.model,
		};
	}

	async stream(messages: LLMMessage[], options: LLMStreamOptions): Promise<LLMCompleteResult> {
		const systemMsg = messages.find((m) => m.role === "system");
		const nonSystemMsgs = messages.filter((m) => m.role !== "system");

		const body: Record<string, unknown> = {
			model: this.config.model,
			messages: nonSystemMsgs.map((m) => ({
				role: m.role as "user" | "assistant",
				content: m.content,
			})),
			stream: true,
		};
		const maxTokens = options.maxTokens ?? this.config.maxTokens;
		if (maxTokens !== undefined) body["max_tokens"] = maxTokens;
		const temperature = options.temperature ?? this.config.temperature ?? 0.3;
		if (temperature !== undefined) body["temperature"] = temperature;
		if (systemMsg) body["system"] = systemMsg.content;
		if (options.stopSequences) body["stop_sequences"] = options.stopSequences;

		const response = await fetch(`${this.baseUrl}/messages`, {
			method: "POST",
			headers: this.headers,
			body: JSON.stringify(body),
			signal: options.abortSignal,
		});

		if (!response.ok) {
			const err = await response.text();
			throw new Error(`Anthropic Compat API error ${response.status}: ${err}`);
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
					if (data.type === "content_block_delta") {
						const delta = data.delta?.text ?? "";
						if (delta) {
							fullText += delta;
							options.onChunk(delta);
						}
					} else if (data.type === "message_delta") {
						outputTokens = data.usage?.output_tokens ?? 0;
					} else if (data.type === "message") {
						inputTokens = data.usage?.input_tokens ?? 0;
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
}
