import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, LLMMessage, LLMCompleteOptions, LLMStreamOptions, LLMCompleteResult, LLMEmbedResult, LLMConfig } from "./provider";

export class ClaudeProvider extends LLMProvider {
	readonly name = "claude";
	private client: Anthropic;
	private config: LLMConfig;

	constructor(config: LLMConfig) {
		super();
		this.config = config;
		this.client = new Anthropic({
			apiKey: config.apiKey || undefined,
			baseURL: config.baseUrl,
			dangerouslyAllowBrowser: true,
		});
	}

	async complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<LLMCompleteResult> {
		const systemMsg = messages.find((m) => m.role === "system");
		const nonSystemMsgs = messages.filter((m) => m.role !== "system");

		const response = await this.client.messages.create({
			model: this.config.model,
			max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
			temperature: options?.temperature ?? this.config.temperature ?? 0.3,
			stop_sequences: options?.stopSequences,
			system: systemMsg?.content,
			messages: nonSystemMsgs.map((m) => ({
				role: m.role as "user" | "assistant",
				content: m.content,
			})),
		}, { signal: options?.abortSignal });

		const text = response.content
			.filter((block): block is Anthropic.TextBlock => block.type === "text")
			.map((block) => block.text)
			.join("");

		return {
			text,
			usage: {
				inputTokens: response.usage.input_tokens,
				outputTokens: response.usage.output_tokens,
			},
			model: response.model,
		};
	}

	async test(): Promise<{ ok: boolean; error?: string; model?: string }> {
		try {
			const response = await this.client.messages.create({
				model: this.config.model,
				max_tokens: 1,
				messages: [{ role: "user", content: "hi" }],
			});
			return { ok: true, model: response.model };
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { ok: false, error: msg };
		}
	}

	async stream(messages: LLMMessage[], options: LLMStreamOptions): Promise<LLMCompleteResult> {
		const systemMsg = messages.find((m) => m.role === "system");
		const nonSystemMsgs = messages.filter((m) => m.role !== "system");
		let fullText = "";
		let inputTokens = 0;
		let outputTokens = 0;

		const stream = this.client.messages.stream({
			model: this.config.model,
			max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
			temperature: options.temperature ?? this.config.temperature ?? 0.3,
			stop_sequences: options.stopSequences,
			system: systemMsg?.content,
			messages: nonSystemMsgs.map((m) => ({
				role: m.role as "user" | "assistant",
				content: m.content,
			})),
		}, { signal: options.abortSignal });

		stream.on("text", (text) => {
			fullText += text;
			options.onChunk(text);
		});

		const finalMessage = await stream.finalMessage();
		inputTokens = finalMessage.usage.input_tokens;
		outputTokens = finalMessage.usage.output_tokens;

		return {
			text: fullText,
			usage: { inputTokens, outputTokens },
			model: finalMessage.model,
		};
	}
}
