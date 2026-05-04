# Ollama Copilot Bridge

Use Ollama Cloud, local Ollama, or any Ollama-compatible OpenAI endpoint from the VS Code chat model picker.

Ollama Copilot Bridge registers an **Ollama Bridge** language model provider in VS Code, discovers your available models, streams responses into chat, and keeps the setup flow inside the editor.

> Ollama Copilot Bridge is community-built and is not affiliated with GitHub, Microsoft, or Ollama.

## Screenshots

Select Ollama Bridge models directly from the VS Code chat model picker:

![Ollama Bridge models in the VS Code chat model picker](https://raw.githubusercontent.com/Noizboy/ollama-copilot-bridge/main/assets/model-picker.png)

Manage your API key, test the connection, and refresh model discovery from the built-in command menu:

![Ollama Copilot Bridge command menu](https://raw.githubusercontent.com/Noizboy/ollama-copilot-bridge/main/assets/command-menu.png)

Review discovered model metadata, including context size and tool or vision capabilities, in VS Code's Language Models view:

![Ollama Bridge models in the VS Code Language Models view](https://raw.githubusercontent.com/Noizboy/ollama-copilot-bridge/main/assets/language-models.jpg)

## Highlights

- Adds **Ollama Bridge** models to the VS Code chat model picker.
- Works with Ollama Cloud by default at `https://ollama.com/v1`.
- Can connect to local Ollama or another compatible endpoint.
- Stores your API key with VS Code SecretStorage.
- Streams chat responses directly into VS Code.
- Discovers model metadata such as context size, output limit, vision support, tool support, and request multiplier when available.
- Supports Agent mode tool calling for compatible models.
- Forwards image attachments to vision-capable models.
- Shows an estimated last-request context usage summary in the status bar hover.
- Retries temporary provider errors such as `429`, `503`, and `504`.

## Requirements

- VS Code `1.104.0` or newer.
- VS Code chat access with contributed language model providers enabled.
- An Ollama Cloud API key, a local Ollama server, or another Ollama/OpenAI-compatible endpoint.

## Quick Start

1. Install **Ollama Copilot Bridge**.
2. Open the Command Palette.
3. Run `Ollama Copilot: Set API Key`.
4. Paste your Ollama Cloud API key.
5. Run `Ollama Copilot: Test Connection`.
6. Open VS Code chat and select an **Ollama Bridge** model from the model picker.

![Selecting an Ollama Bridge model in VS Code chat](https://raw.githubusercontent.com/Noizboy/ollama-copilot-bridge/main/assets/model-picker.png)

By default, the extension connects to:

```txt
https://ollama.com/v1
```

## Commands

| Command | What it does |
| --- | --- |
| `Ollama Copilot: Manage` | Opens the extension action menu. |
| `Ollama Copilot: Set API Key` | Saves or replaces your API key. |
| `Ollama Copilot: Clear API Key` | Removes the saved API key. |
| `Ollama Copilot: Refresh Models` | Reloads model picker entries. |
| `Ollama Copilot: Test Connection` | Checks API access and model discovery. |

![Ollama Copilot Bridge command menu](https://raw.githubusercontent.com/Noizboy/ollama-copilot-bridge/main/assets/command-menu.png)

## Ollama Cloud

The default configuration is ready for Ollama Cloud:

```json
{
  "ollamaCopilot.baseUrl": "https://ollama.com",
  "ollamaCopilot.openaiCompatiblePath": "/v1"
}
```

After setting your API key, run `Ollama Copilot: Test Connection` to confirm that the extension can reach your account and discover models.

## Local Ollama

To use a local Ollama server:

```json
{
  "ollamaCopilot.baseUrl": "http://localhost:11434",
  "ollamaCopilot.openaiCompatiblePath": "/v1"
}
```

Then run `Ollama Copilot: Refresh Models`.

## Model Discovery

The bridge discovers models through Ollama's OpenAI-compatible `/models` endpoint and falls back to native Ollama endpoints when needed.

Each discovered model can be registered with:

- model ID and display name
- model family
- context window
- output token limit
- image capability
- tool-calling capability
- request multiplier metadata

If discovery fails, the extension can still fall back to `ollamaCopilot.defaultModel`.

![Discovered Ollama Bridge models with context and capabilities](https://raw.githubusercontent.com/Noizboy/ollama-copilot-bridge/main/assets/language-models.jpg)

## Vision Models

The bridge forwards VS Code image attachments to Ollama-compatible chat requests when the selected model supports vision.

Vision is enabled when:

- Ollama metadata reports a `vision` capability.
- The model appears to be from a known multimodal family such as `kimi-k2.6`, `llava`, `pixtral`, `gemma3`, `qwen-vl`, `qwen2-vl`, `qwen2.5-vl`, `minicpm-v`, or `moondream`.
- You manually mark a model as image-capable with `ollamaCopilot.visionModels`.

Manual vision configuration accepts exact model IDs and `*` wildcards:

```json
{
  "ollamaCopilot.visionModels": [
    "kimi-k2.6*",
    "qwen2.5-vl:*",
    "my-vision-model:*"
  ]
}
```

After changing this setting, run `Ollama Copilot: Refresh Models`.

If a text-only model receives an image request, the bridge returns a clear error instead of silently dropping the attachment.

## Agent Mode And Tools

For compatible models, Ollama Copilot Bridge translates VS Code Agent mode tools into OpenAI-compatible tool definitions.

The model can request tools, but VS Code remains in control of tool execution, permission prompts, and returned tool results. The bridge converts streamed `tool_calls` back into VS Code language model tool call parts, then sends tool results back to the Ollama-compatible endpoint.

## Context Usage Hover

After a chat request, hover the **Ollama Bridge** status bar item to see an estimate of:

- input context used
- model context window
- estimated response tokens
- total estimated tokens for the last request
- max output tokens
- request multiplier

This is a bridge-owned estimate. VS Code and GitHub Copilot control their own internal context indicator.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ollamaCopilot.enabled` | `true` | Enables or disables the provider. |
| `ollamaCopilot.baseUrl` | `https://ollama.com` | Ollama Cloud, local Ollama, or another compatible base URL. |
| `ollamaCopilot.openaiCompatiblePath` | `/v1` | OpenAI-compatible API path. |
| `ollamaCopilot.defaultModel` | `gpt-oss:20b` | Fallback model when discovery fails. |
| `ollamaCopilot.visionModels` | `["kimi-k2.6*"]` | Model IDs or wildcard patterns treated as image-capable. |
| `ollamaCopilot.maxInputTokens` | `8192` | Fallback input context when metadata is unavailable. |
| `ollamaCopilot.maxOutputTokens` | `2048` | Fallback output token limit when metadata is unavailable. |
| `ollamaCopilot.requestTimeoutMs` | `120000` | Request timeout in milliseconds. |
| `ollamaCopilot.retryMaxAttempts` | `4` | Retry attempts for temporary provider failures. |
| `ollamaCopilot.retryBaseDelayMs` | `1500` | Base delay for retry backoff. |

Example:

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

## Troubleshooting

### No Models Appear

Run `Ollama Copilot: Test Connection`, verify your API key, and confirm that `ollamaCopilot.baseUrl` plus `ollamaCopilot.openaiCompatiblePath` points to a reachable endpoint.

### Images Do Not Work

Use a vision-capable model or add the model ID to `ollamaCopilot.visionModels`, then refresh models.

### Agent Tools Do Not Run

Use VS Code Agent mode and a model that can produce compatible tool calls. Tool execution is controlled by VS Code, so permission prompts and execution behavior come from the editor.

### Requests Timeout

Increase `ollamaCopilot.requestTimeoutMs` or reduce the request size. Temporary cloud errors are retried automatically according to the retry settings.

## Privacy And Security

- API keys are stored with VS Code SecretStorage.
- API keys are not written to the workspace, `settings.json`, or extension files.
- Prompts, images, and tool results are sent to the endpoint you configure.
- Local Ollama keeps requests on your configured local server; Ollama Cloud sends requests to Ollama's hosted service.

## Known Limits

- This extension does not replace GitHub Copilot inline completions.
- This extension does not modify closed internal Copilot UI.
- The model picker and internal context indicator are controlled by VS Code and GitHub Copilot.
- Exact token counting depends on each model tokenizer, so context usage is an estimate.
- Image support depends on VS Code passing the attachment and the selected model actually supporting vision.
- Agent mode quality depends on the selected model's tool-calling behavior.

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

Report issues or feature requests:

```txt
https://github.com/Noizboy/ollama-copilot-bridge/issues
```

## License

MIT
