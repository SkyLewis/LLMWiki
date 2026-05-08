# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-05-08

### Added
- **OpenAI Compat Provider**: native `fetch` implementation bypassing SDK CORS restrictions (supports MiniMax, GLM, 千问, etc.)
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
