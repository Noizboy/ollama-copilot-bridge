# Ollama Copilot Bridge

Use Ollama Cloud and Ollama-compatible models directly from VS Code Copilot Chat through the official VS Code Language Model Provider API.

> This project is community-built and is not affiliated with GitHub, Microsoft, or Ollama.

## Why This Exists

GitHub Copilot Chat in VS Code can work with contributed language models, but external Ollama models need a bridge that speaks both sides:

- VS Code expects a Language Model Chat Provider.
- Ollama Cloud exposes OpenAI-compatible and native Ollama APIs.
- Users need API key storage, model discovery, context metadata, image support, retries, and tool-calling translation to happen automatically.

Ollama Copilot Bridge was created to make that workflow simple: install the extension, set your Ollama API key, select an Ollama Bridge model in Copilot Chat, and start using Ollama models inside the normal VS Code chat experience.

## What It Does

- Registers **Ollama Bridge** as a model provider in VS Code.
- Lists Ollama Cloud or Ollama-compatible models in the Copilot Chat model picker.
- Stores your Ollama API key securely with VS Code SecretStorage.
- Streams model responses into VS Code Chat.
- Fetches model metadata such as context size, capabilities, and request multiplier when available.
- Supports Agent mode tool calling for compatible models.
- Forwards image attachments to vision-capable models.
- Shows a last-request context usage estimate in the status bar hover.
- Retries temporary Ollama Cloud errors such as `429`, `503`, and `504`.

## Quick Start

1. Install the extension.
2. Open the Command Palette.
3. Run:

```txt
Ollama Copilot: Set API Key
```

4. Paste your Ollama Cloud API key.
5. Run:

```txt
Ollama Copilot: Test Connection
```

6. Open Copilot Chat and select an **Ollama Bridge** model from the model picker.

By default, the extension connects to Ollama Cloud:

```txt
https://ollama.com/v1
```

You can also point it to local Ollama or another compatible endpoint.

## Commands

- `Ollama Copilot: Manage` opens the extension action menu.
- `Ollama Copilot: Set API Key` saves or replaces your Ollama API key.
- `Ollama Copilot: Clear API Key` removes the saved API key.
- `Ollama Copilot: Refresh Models` reloads model picker entries.
- `Ollama Copilot: Test Connection` checks API access and model discovery.

## Main Features

### Model Discovery

The bridge discovers models through Ollama's OpenAI-compatible `/models` endpoint and falls back to native Ollama endpoints when needed.

Each discovered model is registered with VS Code using:

- model ID
- display name
- family
- context window
- output token limit
- image support
- tool-calling support
- request multiplier

### Secure API Key Storage

Your API key is stored with VS Code SecretStorage. It is not written to the workspace, `settings.json`, or the extension files.

### Context Usage Hover

After a chat request, hover the **Ollama Bridge** status bar button to see an estimate of:

- input context used
- model context window
- estimated response tokens
- total estimated tokens for the last request
- max output tokens
- request multiplier

This is a bridge-owned estimate. The internal Copilot context indicator is controlled by VS Code and GitHub Copilot.

### Image Input

The bridge forwards VS Code image attachments to Ollama's OpenAI-compatible chat endpoint for vision-capable models.

Image support is enabled when:

- Ollama metadata reports the `vision` capability.
- The model is a known multimodal family such as `kimi-k2.6`, `llava`, `pixtral`, `gemma3`, `qwen-vl`, `qwen2-vl`, `qwen2.5-vl`, `minicpm-v`, or `moondream`.
- You manually mark the model as image-capable with `ollamaCopilot.visionModels`.

If a text-only model receives an image request, the bridge rejects the request with a clear error instead of silently dropping the image.

### Agent Mode And Tool Calling

For compatible models, the bridge translates VS Code tools into OpenAI-compatible tool definitions.

The flow is:

1. VS Code sends available Agent mode tools to the selected Ollama Bridge model.
2. The bridge forwards those tool definitions to Ollama.
3. Streamed `tool_calls` are converted back into VS Code `LanguageModelToolCallPart` responses.
4. VS Code decides whether the tool can run, asks for confirmation when needed, executes it, and returns the result.
5. The bridge sends tool results back to Ollama as OpenAI-compatible `tool` messages.

Tool execution is still controlled by VS Code and GitHub Copilot. The model requests tools; VS Code runs them.

## Settings

Example configuration:

```json
{
  "ollamaCopilot.enabled": true,
  "ollamaCopilot.baseUrl": "https://ollama.com",
  "ollamaCopilot.openaiCompatiblePath": "/v1",
  "ollamaCopilot.defaultModel": "gpt-oss:20b",
  "ollamaCopilot.visionModels": ["kimi-k2.6*"],
  "ollamaCopilot.maxInputTokens": 8192,
  "ollamaCopilot.maxOutputTokens": 2048,
  "ollamaCopilot.requestTimeoutMs": 120000,
  "ollamaCopilot.retryMaxAttempts": 4,
  "ollamaCopilot.retryBaseDelayMs": 1500
}
```

### Important Options

- `ollamaCopilot.enabled`: enables or disables the provider.
- `ollamaCopilot.baseUrl`: Ollama Cloud, local Ollama, or another compatible base URL.
- `ollamaCopilot.openaiCompatiblePath`: OpenAI-compatible API path, usually `/v1`.
- `ollamaCopilot.defaultModel`: fallback model when discovery fails.
- `ollamaCopilot.visionModels`: model IDs or wildcard patterns that should be treated as image-capable.
- `ollamaCopilot.maxInputTokens`: fallback input context when metadata is unavailable.
- `ollamaCopilot.maxOutputTokens`: fallback output limit when metadata is unavailable.
- `ollamaCopilot.requestTimeoutMs`: request timeout.
- `ollamaCopilot.retryMaxAttempts`: retry attempts for temporary failures.
- `ollamaCopilot.retryBaseDelayMs`: base delay for retry backoff.

### Marking Vision Models Manually

Some models can process images even when provider metadata does not include `vision`. Use exact IDs or `*` wildcards:

```json
{
  "ollamaCopilot.visionModels": [
    "kimi-k2.6*",
    "my-vision-model:*",
    "qwen2.5-vl:*"
  ]
}
```

After changing this setting, run:

```txt
Ollama Copilot: Refresh Models
```

## Local Ollama

To use a local Ollama server instead of Ollama Cloud:

```json
{
  "ollamaCopilot.baseUrl": "http://localhost:11434",
  "ollamaCopilot.openaiCompatiblePath": "/v1"
}
```

Then run:

```txt
Ollama Copilot: Refresh Models
```

## Known Limits

- The extension does not replace GitHub Copilot inline completions.
- The extension does not patch Copilot's closed internal UI.
- The Copilot model picker and context indicator are controlled by VS Code and GitHub Copilot.
- Exact token counting depends on each model tokenizer; the status bar context usage is an estimate.
- Image support depends on both VS Code passing the attachment and the selected Ollama model actually supporting vision.
- Agent mode quality depends on the selected model's ability to call tools correctly.

## Development

```bash
npm install
npm run compile
npm run lint
npm test
npm run package
```

To debug locally, press `F5` in VS Code and run the extension in an Extension Development Host.

## Support

Report issues or feature requests here:

```txt
https://github.com/Noizboy/ollama-copilot-bridge/issues
```
