export interface LLMMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface LLMCompleteOptions {
	maxTokens?: number;
	temperature?: number;
	stopSequences?: string[];
	jsonMode?: boolean;
	abortSignal?: AbortSignal;
}

export interface LLMStreamOptions extends LLMCompleteOptions {
	onChunk: (text: string) => void;
}

export interface LLMCompleteResult {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
	};
	model: string;
}

export interface LLMEmbedResult {
	embeddings: number[][];
	usage: {
		inputTokens: number;
	};
}

export interface LLMConfig {
	authMethod?: "apiKey" | "authToken";
	apiKey?: string;
	baseUrl?: string;
	model: string;
	temperature?: number;
	maxTokens?: number;
}

export abstract class LLMProvider {
	abstract readonly name: string;
	abstract complete(messages: LLMMessage[], options?: LLMCompleteOptions): Promise<LLMCompleteResult>;
	abstract stream(messages: LLMMessage[], options: LLMStreamOptions): Promise<LLMCompleteResult>;
	abstract test(): Promise<{ ok: boolean; error?: string; model?: string }>;
	embed?(texts: string[], abortSignal?: AbortSignal): Promise<LLMEmbedResult>;
}
