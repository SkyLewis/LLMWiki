# LLM Wiki

A persistent, compounding knowledge base for [Obsidian](https://obsidian.md). LLM Wiki incrementally builds and maintains a structured wiki of markdown files between you and raw sources — not RAG (re-deriving on every query), but compiled knowledge that accumulates over time.

Based on [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

## How It Works

The wiki operates in three layers:

```
┌─────────────────────────────────────────┐
│  Raw Sources (immutable)                │
│  articles, papers, notes                │
├─────────────────────────────────────────┤
│  Wiki (LLM-owned)                       │
│  summaries, entities, concepts,          │
│  synthesis — LLM creates & maintains     │
├─────────────────────────────────────────┤
│  Schema (co-evolved)                    │
│  conventions, workflows, page formats    │
└─────────────────────────────────────────┘
```

Every source you ingest and every question you ask makes the wiki richer. Cross-references are already there. Contradictions are already flagged. Synthesis already reflects everything read.

## Features

- **Three-tier retrieval**: keyword → semantic (vector) → graph traversal
- **Append-first merge**: pages grow with dated subsections, never overwritten
- **Structured contradictions**: claims annotated with divergence types (context-dependent, factual, temporal, methodological)
- **Knowledge graph**: typed relationships between concepts and entities
- **Model router**: task-aware model selection — lightweight for extraction, heavy for synthesis
- **Intent workflows**: Deep Explore, Verify Claim, Trace Contradiction, Comprehensive Review
- **Human-in-the-loop**: all changes shown in diff view before committing
- **Atomic transactions**: multi-file operations with rollback on failure
- **Schema evolution**: the wiki's own schema evolves based on usage patterns
- **Multi-provider**: Claude, OpenAI, Ollama (local)

## Installation

### Obsidian Community Plugins (recommended)

*Coming soon — pending submission to the Obsidian community plugin list.*

### BRAT (beta releases)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins
2. Open BRAT Settings → "Add Beta Plugin"
3. Enter the repository URL: `https://github.com/SkyLewis/LLMWiki`
4. Enable the plugin in Obsidian settings

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/SkyLewis/LLMWiki/releases/latest)
2. Create folder `.obsidian/plugins/llm-wiki/` in your vault
3. Copy the three files into that folder
4. Enable the plugin in Obsidian Settings → Community Plugins

## Configuration

After enabling the plugin, open Settings → LLM Wiki to configure:

- **Model Router**: assign providers/models to each tier (heavy lift, default, lightweight, local fallback)
- **API Keys**: enter your Anthropic, OpenAI, or Ollama endpoint credentials
- **Vault Paths**: customize raw source and wiki output directories
- **Merge Threshold**: word count that triggers page refactoring flags

Ollama users can run without any API keys — set it as the default or local fallback provider.

## Usage

### Commands

| Command | Description |
|---------|-------------|
| Ingest Source | Process a raw source file into wiki pages |
| Ingest Current File | Ingest the currently open file |
| Query Wiki | Ask a natural language question |
| Lint Wiki | Health check: orphans, contradictions, schema drift |
| Deep Explore | Explore a concept across all sources |
| Verify Claim | Trace a claim back to its sources |
| Trace Contradiction | Map conflicting sources |
| Comprehensive Review | Full wiki audit |

### Vault Structure

```
vault/
├── raw/              # Your source files (immutable)
│   ├── articles/
│   ├── papers/
│   └── notes/
├── wiki/             # LLM-generated wiki
│   ├── index.md      # Content catalog
│   ├── log.md        # Operation log
│   ├── entities/     # People, orgs, products
│   ├── concepts/     # Ideas, frameworks, topics
│   ├── sources/      # Source summaries
│   └── synthesis/    # Comparisons, analyses
└── .llm-wiki/        # Runtime state & indexes
    ├── schema.md     # Wiki conventions
    ├── graph.json    # Knowledge graph
    └── vectors.json  # Semantic embeddings
```

## Development

```bash
npm install        # Install dependencies
npm run dev        # Build in watch mode
npm run build      # Production build
```

For local development, symlink the project output to your vault:

```bash
# Create symlink (adjust paths to your vault)
mklink "<vault>\.obsidian\plugins\llm-wiki\main.js" "<project>\main.js"
```

## License

[MIT](LICENSE)
