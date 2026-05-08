import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type LLMWikiPlugin from "../main";
import type { ModelRouterConfig, ModelTierConfig } from "../llm/model-router";
import { ClaudeProvider } from "../llm/claude-provider";
import { OpenAIProvider } from "../llm/openai-provider";
import { OpenAICompatProvider } from "../llm/openai-compat-provider";
import { AnthropicCompatProvider } from "../llm/anthropic-compat-provider";
import { OllamaProvider } from "../llm/ollama-provider";
import type { LLMConfig } from "../llm/provider";

export interface LLMWikiSettings {
	rawPath: string;
	wikiPath: string;
	llmWikiDir: string;
	modelRouter: ModelRouterConfig;
	mergeThreshold: number;
	enableSemanticSearch: boolean;
	graphTraversalHops: number;
	schemaDriftPercentage: number;
	schemaMinSampleSize: number;
	embeddingSource: "provider" | "local";
	localEmbeddingModel: string;
}

export const DEFAULT_SETTINGS: LLMWikiSettings = {
	rawPath: "raw",
	wikiPath: "wiki",
	llmWikiDir: ".llm-wiki",
	modelRouter: {
		default: {
			provider: "claude",
			model: "claude-sonnet-4-20250514",
			temperature: 0.3,
			maxTokens: 4096,
		},
		heavy_lift: {
			provider: "claude",
			model: "claude-opus-4-20250514",
			temperature: 0.3,
			maxTokens: 8192,
		},
		lightweight: {
			provider: "claude",
			model: "claude-haiku-4-20250414",
			temperature: 0.2,
			maxTokens: 2048,
		},
	},
	mergeThreshold: 3000,
	enableSemanticSearch: true,
	graphTraversalHops: 2,
	schemaDriftPercentage: 70,
	schemaMinSampleSize: 20,
	embeddingSource: "provider",
	localEmbeddingModel: "all-MiniLM-L6-v2",
};

export class LLMWikiSettingTab extends PluginSettingTab {
	plugin: LLMWikiPlugin;

	constructor(app: App, plugin: LLMWikiPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "LLM Wiki Settings" });

		// ── Paths ──
		containerEl.createEl("h3", { text: "Vault Paths" });

		new Setting(containerEl)
			.setName("Raw sources directory")
			.setDesc("Directory for raw source files (articles, papers, notes)")
			.addText((text) =>
				text.setValue(this.plugin.settings.rawPath).onChange(async (value) => {
					this.plugin.settings.rawPath = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Wiki directory")
			.setDesc("Directory for LLM-generated wiki pages")
			.addText((text) =>
				text.setValue(this.plugin.settings.wikiPath).onChange(async (value) => {
					this.plugin.settings.wikiPath = value;
					await this.plugin.saveSettings();
				})
			);

		// ── Model Router ──
		containerEl.createEl("h3", { text: "Model Router" });
		this.addTierSettings(containerEl, "Default (general operations)", "default");
		this.addTierSettings(containerEl, "Heavy Lift (synthesis, contradiction analysis)", "heavy_lift");
		this.addTierSettings(containerEl, "Lightweight (tag extraction, index updates)", "lightweight");
		this.addTierSettings(containerEl, "Local Fallback (offline / sensitive content)", "local_fallback");

		// ── Merge & Thresholds ──
		containerEl.createEl("h3", { text: "Merge & Thresholds" });

		new Setting(containerEl)
			.setName("Merge threshold (words)")
			.setDesc("Pages exceeding this word count are flagged for refactoring")
			.addSlider((slider) =>
				slider
					.setLimits(1000, 10000, 500)
					.setValue(this.plugin.settings.mergeThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.mergeThreshold = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Search & Retrieval ──
		containerEl.createEl("h3", { text: "Search & Retrieval" });

		new Setting(containerEl)
			.setName("Enable semantic search")
			.setDesc("Use vector embeddings for semantic similarity matching")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.enableSemanticSearch).onChange(async (value) => {
					this.plugin.settings.enableSemanticSearch = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Graph traversal hops")
			.setDesc("Number of hops for graph-expanded retrieval (1-3)")
			.addSlider((slider) =>
				slider
					.setLimits(1, 3, 1)
					.setValue(this.plugin.settings.graphTraversalHops)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.graphTraversalHops = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Embedding source")
			.setDesc("Provider API or local model (Transformers.js)")
			.addDropdown((dd) =>
				dd
					.addOptions({ provider: "Provider API", local: "Local (Transformers.js)" })
					.setValue(this.plugin.settings.embeddingSource)
					.onChange(async (value: string) => {
						this.plugin.settings.embeddingSource = value as "provider" | "local";
						await this.plugin.saveSettings();
					})
			);

		// ── Schema Evolution ──
		containerEl.createEl("h3", { text: "Schema Evolution" });

		new Setting(containerEl)
			.setName("Schema drift percentage")
			.setDesc("Percentage of pages with a new section to trigger schema amendment proposal")
			.addSlider((slider) =>
				slider
					.setLimits(30, 100, 5)
					.setValue(this.plugin.settings.schemaDriftPercentage)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.schemaDriftPercentage = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Minimum sample size")
			.setDesc("Minimum pages in a category before drift detection activates")
			.addSlider((slider) =>
				slider
					.setLimits(5, 50, 5)
					.setValue(this.plugin.settings.schemaMinSampleSize)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.schemaMinSampleSize = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private addTierSettings(containerEl: HTMLElement, label: string, tier: keyof ModelRouterConfig): void {
		new Setting(containerEl).setName(label).setHeading();

		const tierConfig = this.plugin.settings.modelRouter[tier] ?? {
			provider: "claude" as const,
			model: "",
		};

		new Setting(containerEl)
			.setName("Provider")
			.addDropdown((dd) =>
				dd
					.addOptions({
					claude: "Claude (官方)",
					claude_compat: "Claude 兼容 (Bearer/X-Api-Key)",
					openai: "OpenAI (官方)",
					openai_compat: "OpenAI 兼容 (Bearer/X-Api-Key)",
					ollama: "Ollama (本地)",
				})
					.setValue(tierConfig.provider)
					.onChange(async (value: string) => {
						if (!this.plugin.settings.modelRouter[tier]) {
							this.plugin.settings.modelRouter[tier] = {
								provider: value as ModelTierConfig["provider"],
								model: "",
							};
						}
						(this.plugin.settings.modelRouter[tier] as ModelTierConfig).provider = value as ModelTierConfig["provider"];
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auth Method")
			.setDesc("apiKey = X-Api-Key header; authToken = Bearer token (for MiniMax, Azure, etc.)")
			.addDropdown((dd) =>
				dd
					.addOptions({ apiKey: "API Key (X-Api-Key)", authToken: "Auth Token (Bearer)" })
					.setValue(tierConfig.authMethod ?? "apiKey")
					.onChange(async (value: string) => {
						if (!this.plugin.settings.modelRouter[tier]) {
							this.plugin.settings.modelRouter[tier] = {
								provider: "claude",
								model: "",
							};
						}
						(this.plugin.settings.modelRouter[tier] as ModelTierConfig).authMethod = value as "apiKey" | "authToken";
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Model")
			.addText((text) =>
				text
					.setPlaceholder("e.g. claude-sonnet-4-20250514")
					.setValue(tierConfig.model)
					.onChange(async (value) => {
						if (!this.plugin.settings.modelRouter[tier]) {
							this.plugin.settings.modelRouter[tier] = {
								provider: "claude",
								model: value,
							};
						}
						(this.plugin.settings.modelRouter[tier] as ModelTierConfig).model = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("API Key")
			.addText((text) => {
				text
					.setPlaceholder("sk-...")
					.setValue(tierConfig.apiKey ?? "")
					.onChange(async (value) => {
						if (!this.plugin.settings.modelRouter[tier]) return;
						(this.plugin.settings.modelRouter[tier] as ModelTierConfig).apiKey = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = "password";
			});

		new Setting(containerEl)
			.setName("Base URL (optional)")
			.addText((text) =>
				text
					.setPlaceholder("https://api.anthropic.com")
					.setValue(tierConfig.baseUrl ?? "")
					.onChange(async (value) => {
						if (!this.plugin.settings.modelRouter[tier]) return;
						(this.plugin.settings.modelRouter[tier] as ModelTierConfig).baseUrl = value || undefined;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("")
			.addButton((btn) =>
				btn
					.setButtonText("Test Connection")
					.setClass("test-connection-btn")
					.onClick(async () => {
						if (!this.plugin.settings.modelRouter[tier]) return;
						const cfg = this.plugin.settings.modelRouter[tier] as ModelTierConfig;
						const llmConfig: LLMConfig = {
							authMethod: cfg.authMethod,
							apiKey: cfg.apiKey || undefined,
							baseUrl: cfg.baseUrl,
							model: cfg.model,
						};
						let provider;
						if (cfg.provider === "claude") provider = new ClaudeProvider(llmConfig);
						else if (cfg.provider === "claude_compat") provider = new AnthropicCompatProvider(llmConfig);
						else if (cfg.provider === "openai") provider = new OpenAIProvider(llmConfig);
						else if (cfg.provider === "openai_compat") provider = new OpenAICompatProvider(llmConfig);
						else if (cfg.provider === "ollama") provider = new OllamaProvider(llmConfig);
						if (!provider) return;
						const result = await provider.test();
						new Notice(result.ok ? `✓ Connected — model: ${result.model}` : `✗ Failed: ${result.error}`);
					})
			);
	}
}
