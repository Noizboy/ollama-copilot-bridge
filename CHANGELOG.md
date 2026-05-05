# Changelog

## 0.0.12

- Updated Marketplace documentation and package description to state that the extension is specifically for GitHub Copilot Chat in VS Code.

## 0.0.11

- Added multi-connection model discovery for Cloud, Local, VPS, and custom endpoints at the same time.
- Preserved primary connection model IDs for compatibility with existing agents.
- Added source labels so secondary models show their Cloud, Local, VPS, or custom origin in the picker.
- Added per-connection API key storage.

## 0.0.10

- Added a unified connection setup flow through `Ollama Copilot: Set API Key / Configure Connection`.
- Added support for Cloud, local Ollama, remote Ollama, and custom OpenAI-compatible profiles from one wizard.
- Added URL normalization for pasted Ollama endpoint paths such as `/api/tags`.

## 0.0.9

- Added persistent model metadata caching with configurable TTL.
- Added concurrent model metadata enrichment for faster model discovery.
- Added model picker controls for pinned and hidden models.
- Added diagnostics command with model discovery and chat latency metrics.

## 0.0.8

- Added Marketplace README screenshots for the model picker, command menu, and Language Models view.
- Updated the extension description to mention local Ollama, model discovery, tools, and vision support.

## 0.0.7

- Refreshed the Marketplace README with clearer setup, configuration, troubleshooting, and privacy guidance.

## 0.0.6

- Added `ollamaCopilot.visionModels` for manually marking model IDs or wildcard patterns as image-capable.

## 0.0.5

- Marked known Ollama vision models such as `kimi-k2.6:cloud` as image-capable when provider metadata omits `vision`.
- Added tests for vision model inference.

## 0.0.4

- Added image attachment forwarding for vision-capable models.
- Added a clear error when images are attached to text-only models.

## 0.0.3

- Added a status bar hover with last-request context usage for Ollama Bridge models.
- Added context usage helpers and unit tests.
- Documented the bridge-owned context usage estimate.

## 0.0.2

- Added OpenAI-compatible tool call streaming support for VS Code Agent mode.
- Converted VS Code tool results back into OpenAI-compatible `tool` messages.
- Added unit tests for streamed tool call parsing.
- Documented Agent mode and tool calling behavior.

## 0.0.1

- Initial MVP with Ollama Cloud support, VS Code Language Model Chat Provider registration, secure API key storage, and management commands.
