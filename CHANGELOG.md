# Changelog

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
