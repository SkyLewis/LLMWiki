# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.16] - 2026-05-08

### Fixed
- **Source page TFolder conflict**: `ingest` now guards against TFolder path conflicts when creating the source summary page, throwing a descriptive error instead of "File already exists"

## [0.2.14] - 2026-05-08

### Fixed
- **Transaction begin "already exists"**: Added safeCreateFolder helper to catch "already exists" errors in Transaction.begin() when creating llmWikiDir, tx folder, and txDir

## [0.2.11] - 2026-05-08

### Changed
- **Provider default to empty**: Default settings now have `provider: ""` instead of `"claude"`, forcing users to explicitly configure a provider before use
- **resolve() throws on empty provider**: ModelRouter.resolve() now throws an error if provider is not configured, rather than silently falling back to claude

## [0.2.10] - 2026-05-08

## [0.2.9] - 2026-05-08

### Added
- **Transaction logging**: Added `[Transaction]` prefix logs to `Transaction.begin()` for step-by-step debugging of tx dir creation and manifest writing
- **File conflict detection**: Added explicit check for TFolder vs TFile vs null in page creation loop, preventing "file already exists" errors when path conflicts with a folder

### Changed
- **Finer-grained Ingest logging**: Added `File check:` logging before each page create/modify to trace exact file state

## [0.2.8] - 2026-05-08

### Added
- **Ingest logging**: Added `console.log` instrumentation at key steps — phase start/end, token counts, extraction/synthesis results, page create/update operations, graph updates, and errors with stack traces

## [0.2.7] - 2026-05-08

### Fixed
- **Directory already exists error**: `ensureDirectory` catches "already exists" errors gracefully, preventing ingest from exiting prematurely when multiple pages share the same parent directory

## [0.2.6] - 2026-05-08

### Fixed
- **Ingest JSON parse error**: `parseJSON` regex now correctly extracts JSON from ` ```json ` code blocks only, preventing `thinking` block content from corrupting JSON extraction

## [0.2.1] - 2026-05-08

### Fixed
- **Test Connection button**: fix for compat providers (`claude_compat`, `openai_compat`) not responding — add missing provider branches and imports

## [0.2.0] - 2026-05-08

### Added
- **OpenAI Compat Provider**: native `fetch` implementation bypassing SDK CORS restrictions (supports MiniMax, GLM, qianwen, etc.)
- **Anthropic Compat Provider**: native `fetch` implementation bypassing SDK CORS restrictions
- Provider dropdown now offers 5 options: Claude (official), Claude Compat (Bearer/X-Api-Key), OpenAI (official), OpenAI Compat (Bearer/X-Api-Key), Ollama (local)
- Compatible providers use no SDK-added headers (`x-stainless-*`), solving CORS preflight failures on third-party APIs

### Changed
- `ModelTierConfig.provider` expanded from 3 to 5 provider types

## [0.1.0] - 2026-05-07

### Added
- Three-tier retrieval: keyword, semantic (vector), graph traversal
- Ingest engine with append-first merge protocol
- Structured contradiction annotation with divergence types
- Query engine with `[[wiki-links]]` citations
- Lint engine with orphan detection and schema evolution proposals
- Model router: task-aware tiered model selection (heavy/default/light/local)
- Knowledge graph index with typed edges
- Intent-driven workflows: Deep Explore, Verify Claim, Trace Contradiction, Comprehensive Review
- Transaction mechanism for atomic multi-file operations
- Background task queue with progress tracking
- Human-in-the-loop diff review for all page modifications
- Schema versioning and self-evolution
- Support for Claude, OpenAI, and Ollama providers
