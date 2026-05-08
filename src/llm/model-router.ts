import { LLMProvider, LLMConfig } from "./provider";
import { ClaudeProvider } from "./claude-provider";
import { OpenAIProvider } from "./openai-provider";
import { OllamaProvider } from "./ollama-provider";

export type ModelTier = "default" | "heavy_lift" | "lightweight" | "local_fallback";

export type TaskType =
	| "ingest-extract"
	| "ingest-synthesize"
	| "query-answer"
	| "lint-analyze"
	| "index-update"
	| "contradiction-analyze"
	| "semantic-desc"
	| "embed"
	| "schema-evolve"
	| "workflow-step";

const TASK_TIER_MAP: Record<TaskType, ModelTier> = {
	"ingest-extract": "lightweight",
	"ingest-synthesize": "heavy_lift",
	"query-answer": "default",
	"lint-analyze": "heavy_lift",
	"index-update": "lightweight",
	"contradiction-analyze": "heavy_lift",
	"semantic-desc": "lightweight",
	"embed": "lightweight",
	"schema-evolve": "heavy_lift",
	"workflow-step": "default",
};

export interface ModelRouterConfig {
	default: ModelTierConfig;
	heavy_lift?: ModelTierConfig;
	lightweight?: ModelTierConfig;
	local_fallback?: ModelTierConfig;
}

export interface ModelTierConfig {
	provider: "claude" | "openai" | "ollama";
	model: string;
	authMethod?: "apiKey" | "authToken";
	apiKey?: string;
	baseUrl?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface TokenCostEntry {
	tier: ModelTier;
	taskType: TaskType;
	inputTokens: number;
	outputTokens: number;
	timestamp: number;
}

export class ModelRouter {
	private providers: Map<string, LLMProvider> = new Map();
	private config: ModelRouterConfig;
	private costLog: TokenCostEntry[] = [];

	constructor(config: ModelRouterConfig) {
		this.config = config;
		this.initProviders();
	}

	private initProviders(): void {
		const tiers: ModelTier[] = ["default", "heavy_lift", "lightweight", "local_fallback"];
		const seen = new Set<string>();

		for (const tier of tiers) {
			const tierConfig = this.config[tier];
			if (!tierConfig) continue;

			const key = `${tierConfig.provider}:${tierConfig.baseUrl ?? "default"}`;
			if (seen.has(key)) continue;
			seen.add(key);

			const llmConfig: LLMConfig = {
				authMethod: tierConfig.authMethod,
				apiKey: tierConfig.apiKey,
				baseUrl: tierConfig.baseUrl,
				model: tierConfig.model,
				temperature: tierConfig.temperature,
				maxTokens: tierConfig.maxTokens,
			};

			switch (tierConfig.provider) {
				case "claude":
					this.providers.set(key, new ClaudeProvider(llmConfig));
					break;
				case "openai":
					this.providers.set(key, new OpenAIProvider(llmConfig));
					break;
				case "ollama":
					this.providers.set(key, new OllamaProvider(llmConfig));
					break;
			}
		}
	}

	resolve(taskType: TaskType): { provider: LLMProvider; config: ModelTierConfig; tier: ModelTier } {
		const tier = TASK_TIER_MAP[taskType] ?? "default";
		const tierConfig = this.config[tier] ?? this.config.default;

		const key = `${tierConfig.provider}:${tierConfig.baseUrl ?? "default"}`;
		const provider = this.providers.get(key);
		if (!provider) {
			// Fallback to default provider
			const defaultKey = `${this.config.default.provider}:${this.config.default.baseUrl ?? "default"}`;
			const defaultProvider = this.providers.get(defaultKey);
			if (!defaultProvider) throw new Error(`No provider available for task ${taskType}`);
			return { provider: defaultProvider, config: this.config.default, tier: "default" };
		}

		return { provider, config: tierConfig, tier };
	}

	recordCost(entry: TokenCostEntry): void {
		this.costLog.push(entry);
	}

	getCostSummary(): Record<ModelTier, { inputTokens: number; outputTokens: number; count: number }> {
		const summary: Record<string, { inputTokens: number; outputTokens: number; count: number }> = {
			default: { inputTokens: 0, outputTokens: 0, count: 0 },
			heavy_lift: { inputTokens: 0, outputTokens: 0, count: 0 },
			lightweight: { inputTokens: 0, outputTokens: 0, count: 0 },
			local_fallback: { inputTokens: 0, outputTokens: 0, count: 0 },
		};

		for (const entry of this.costLog) {
			summary[entry.tier].inputTokens += entry.inputTokens;
			summary[entry.tier].outputTokens += entry.outputTokens;
			summary[entry.tier].count++;
		}

		return summary as Record<ModelTier, { inputTokens: number; outputTokens: number; count: number }>;
	}

	getProviderForTier(tier: ModelTier): LLMProvider | null {
		const tierConfig = this.config[tier];
		if (!tierConfig) return null;
		const key = `${tierConfig.provider}:${tierConfig.baseUrl ?? "default"}`;
		return this.providers.get(key) ?? null;
	}

	updateConfig(config: ModelRouterConfig): void {
		this.config = config;
		this.providers.clear();
		this.initProviders();
	}
}
