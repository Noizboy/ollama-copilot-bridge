# Ollama Copilot Bridge

Extension MVP for using Ollama Cloud models from VS Code chat through the official Language Model Chat Provider API.

## What It Does

- Registers the `ollama-bridge` model provider in VS Code as **Ollama Bridge**.
- Connects to Ollama Cloud at `https://ollama.com/v1` by default.
- Stores your Ollama Cloud API key securely with VS Code SecretStorage.
- Streams chat responses from Ollama Cloud into VS Code chat.
- Can also be pointed at local Ollama by changing `ollamaCopilot.baseUrl` to `http://localhost:11434`.

## Commands

- `Ollama Copilot: Manage`
- `Ollama Copilot: Set API Key`
- `Ollama Copilot: Clear API Key`
- `Ollama Copilot: Refresh Models`
- `Ollama Copilot: Test Connection`

## Settings

```json
{
  "ollamaCopilot.baseUrl": "https://ollama.com",
  "ollamaCopilot.openaiCompatiblePath": "/v1",
  "ollamaCopilot.defaultModel": "gpt-oss:20b",
  "ollamaCopilot.retryMaxAttempts": 4,
  "ollamaCopilot.retryBaseDelayMs": 1500
}
```

`503 Server overloaded` comes from Ollama Cloud. The extension retries temporary `429`, `503`, and `504` failures automatically before surfacing the error to VS Code.

## Model Metadata

The bridge enriches models automatically with `POST /api/show`:

- Context size comes from `*.context_length` in `model_info`, with `num_ctx` fallback.
- Capabilities come from Ollama's `capabilities` array.
- Request multiplier is read if the provider returns one; otherwise it is estimated from `general.parameter_count`.

## Agent Mode And Tool Calling

Ollama Copilot Bridge supports VS Code tool calling for compatible Ollama models:

- VS Code sends available Agent mode tools to the selected Ollama Bridge model.
- The bridge forwards tool definitions to Ollama's OpenAI-compatible chat endpoint.
- Streamed `tool_calls` are converted back into VS Code `LanguageModelToolCallPart` responses.
- Follow-up tool results from VS Code are sent back to Ollama as OpenAI-compatible `tool` messages.

Tool execution is still controlled by VS Code and GitHub Copilot. The model only requests a tool call; VS Code decides whether the tool is available, asks for confirmation when needed, runs the tool, and returns the result.

## Development

```bash
npm install
npm run compile
npm test
```

Then press `F5` in VS Code and run the extension in an Extension Development Host.

Set your Ollama Cloud API key from the Command Palette:

```txt
Ollama Copilot: Set API Key
```

Then run:

```txt
Ollama Copilot: Test Connection
```

## Notes

This extension integrates with VS Code's official language model provider surface. It does not patch or replace the closed GitHub Copilot inline completion engine. In supported VS Code/Copilot Chat builds, contributed language models appear in the chat model picker.
