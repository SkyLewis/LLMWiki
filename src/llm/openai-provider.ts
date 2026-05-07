import OpenAI from "openai";
import { LLMProvider, LLMMessage, LLMCompleteOptions, LLMStreamOptions, LLMCompleteResult, LLMEmbedResult, LLMConfig } from "./provider";

export class OpenAIProvider extends LLMProvider {
	readonly name = "openai";
	private client: OpenAI;
	private config: LLMConfig;

	constructor(config: LLMConfig) {
		super();
		this.config = config;
		this.client = new OpenAI({
			apiKey: config.apiKey,
			baseURL: config.baseUrl,
		});
	}

	async complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<LLMCompleteResult> {
		const response = await this.client.chat.completions.create({
			model: this.config.model,
			messages: messages.map((m) => ({
				role: m.role as "system" | "user" | "assistant",
				content: m.content,
			})),
			max_tokens: options?.maxTokens ?? this.config.maxTokens ?? 4096,
			temperature: options?.temperature ?? this.config.temperature ?? 0.3,
			stop: options?.stopSequences,
			response_format: options?.jsonMode ? { type: "json_object" } : undefined,
		}, { signal: options?.abortSignal });

		return {
			text: response.choices[0]?.message?.content ?? "",
			usage: {
				inputTokens: response.usage?.prompt_tokens ?? 0,
				outputTokens: response.usage?.completion_tokens ?? 0,
			},
			model: response.model,
		};
	}

	async stream(messages: LLMMessage[], options: LLMStreamOptions): Promise<LLMCompleteResult> {
		const stream = await this.client.chat.completions.create({
			model: this.config.model,
			messages: messages.map((m) => ({
				role: m.role as "system" | "user" | "assistant",
				content: m.content,
			})),
			max_tokens: options.maxTokens ?? this.config.maxTokens ?? 4096,
			temperature: options.temperature ?? this.config.temperature ?? 0.3,
			stop: options.stopSequences,
			response_format: options.jsonMode ? { type: "json_object" } : undefined,
			stream: true,
		}, { signal: options.abortSignal });

		let fullText = "";
		let inputTokens = 0;
		let outputTokens = 0;

		for await (const chunk of stream) {
			const delta = chunk.choices[0]?.delta?.content ?? "";
			if (delta) {
				fullText += delta;
				options.onChunk(delta);
			}
			if (chunk.usage) {
				inputTokens = chunk.usage.prompt_tokens;
				outputTokens = chunk.usage.completion_tokens;
			}
		}

		return {
			text: fullText,
			usage: { inputTokens, outputTokens },
			model: this.config.model,
		};
	}

	async embed(texts: string[], abortSignal?: AbortSignal): Promise<LLMEmbedResult> {
		const response = await this.client.embeddings.create({
			model: "text-embedding-3-small",
			input: texts,
		}, { signal: abortSignal });

		return {
			embeddings: response.data.map((d) => d.embedding),
			usage: {
				inputTokens: response.usage?.prompt_tokens ?? 0,
			},
		};
	}
}
