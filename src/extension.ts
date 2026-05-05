import * as vscode from "vscode";
import { affectsBridgeConfig, getBridgeConfig } from "./config";
import { formatTokenCount, type ContextUsageSnapshot } from "./contextUsage";
import { OllamaClient } from "./ollamaClient";
import { OllamaLanguageModelProvider } from "./provider";
import { SecretStore } from "./secrets";

const configSection = "ollamaCopilot";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Ollama Copilot Bridge");
  const secrets = new SecretStore(context.secrets);
  const client = new OllamaClient(secrets, context.globalState);
  const provider = new OllamaLanguageModelProvider(client, output);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 72);

  status.command = "ollamaCopilot.manage";
  status.text = "$(cloud) Ollama Bridge";
  status.tooltip = buildIdleStatusTooltip();
  status.show();

  context.subscriptions.push(
    output,
    status,
    {
      dispose: () => provider.refresh()
    },
    vscode.lm.registerLanguageModelChatProvider("ollama-bridge", provider),
    vscode.commands.registerCommand("ollamaCopilot.manage", () => manageBridge(client, secrets, provider, output)),
    vscode.commands.registerCommand("ollamaCopilot.setApiKey", () => configureConnection(client, secrets, provider)),
    vscode.commands.registerCommand("ollamaCopilot.clearApiKey", () => clearApiKey(secrets)),
    vscode.commands.registerCommand("ollamaCopilot.refreshModels", () => refreshModels(client, provider)),
    vscode.commands.registerCommand("ollamaCopilot.testConnection", () => testConnection(client)),
    vscode.commands.registerCommand("ollamaCopilot.diagnostics", () => showDiagnostics(client, output)),
    provider.onDidUpdateContextUsage((snapshot) => {
      status.tooltip = buildContextStatusTooltip(snapshot);
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!affectsBridgeConfig(event)) {
        return;
      }

      provider.refresh();
    })
  );
}

export function deactivate(): void {}

async function manageBridge(
  client: OllamaClient,
  secrets: SecretStore,
  provider: OllamaLanguageModelProvider,
  output: vscode.OutputChannel
): Promise<void> {
  const config = getBridgeConfig();
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: "$(settings-gear) Set API Key / Configure Connection",
        detail: "Configure Cloud, local Ollama, remote Ollama, or a custom endpoint",
        action: "setApiKey"
      },
      {
        label: "$(plug) Test Connection",
        detail: config.baseUrl,
        action: "test"
      },
      {
        label: "$(trash) Clear API Key",
        detail: "Remove the saved Ollama Cloud API key",
        action: "clearApiKey"
      },
      {
        label: "$(refresh) Refresh Models",
        detail: "Reload the model picker entries",
        action: "refresh"
      },
      {
        label: "$(pulse) Diagnostics",
        detail: "Show connection, model cache, and last chat latency details",
        action: "diagnostics"
      }
    ],
    {
      title: "Ollama Copilot Bridge",
      placeHolder: "Choose an action"
    }
  );

  if (!selected) {
    return;
  }

  switch (selected.action) {
    case "test":
      await testConnection(client);
      break;
    case "setApiKey":
      await configureConnection(client, secrets, provider);
      break;
    case "clearApiKey":
      await clearApiKey(secrets);
      break;
    case "refresh":
      await refreshModels(client, provider);
      break;
    case "diagnostics":
      await showDiagnostics(client, output);
      break;
  }
}

async function clearApiKey(secrets: SecretStore): Promise<void> {
  const confirmation = await vscode.window.showWarningMessage(
    "Remove the saved Ollama Cloud API key?",
    { modal: true },
    "Clear API Key"
  );

  if (confirmation !== "Clear API Key") {
    return;
  }

  await secrets.clearApiKey();
  void vscode.window.showInformationMessage("Ollama API key cleared.");
}

async function configureConnection(
  client: OllamaClient,
  secrets: SecretStore,
  provider: OllamaLanguageModelProvider
): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: "$(cloud) Ollama Cloud",
        description: "Hosted Ollama API",
        mode: "cloud" as const
      },
      {
        label: "$(device-desktop) Local Ollama",
        description: "http://localhost:11434",
        mode: "local" as const
      },
      {
        label: "$(globe) Remote Ollama / VPS",
        description: "Self-hosted Ollama behind a domain, IP, tunnel, or reverse proxy",
        mode: "remote" as const
      },
      {
        label: "$(plug) Custom OpenAI-Compatible",
        description: "Compatible endpoint with configurable /v1 path",
        mode: "custom" as const
      }
    ],
    {
      title: "Ollama Copilot Bridge Connection",
      placeHolder: "Choose the connection type"
    }
  );

  if (!selected) {
    return;
  }

  const config = vscode.workspace.getConfiguration(configSection);
  let baseUrl = selected.mode === "cloud" ? "https://ollama.com" : "http://localhost:11434";
  let openaiPath = "/v1";
  let keyMode: "required" | "optional" | "none" = selected.mode === "cloud" ? "required" : "none";
  let connectionLabel = selected.mode === "cloud" ? "Cloud" : selected.mode === "local" ? "Local" : "VPS";
  let connectionId = selected.mode === "cloud" ? "cloud" : selected.mode === "local" ? "local" : selected.mode;

  if (selected.mode === "remote" || selected.mode === "custom") {
    const label = await vscode.window.showInputBox({
      title: selected.mode === "remote" ? "Remote Connection Name" : "Custom Connection Name",
      prompt: "This name is shown as the model source in VS Code.",
      value: selected.mode === "remote" ? "VPS" : "Custom",
      ignoreFocusOut: true
    });

    if (label === undefined) {
      return;
    }

    connectionLabel = label.trim() || connectionLabel;
    connectionId = normalizeConnectionId(connectionLabel);

    const value = await vscode.window.showInputBox({
      title: selected.mode === "remote" ? "Remote Ollama Base URL" : "Custom Base URL",
      prompt: "Paste the server URL. Full Ollama paths like /api/tags are accepted and normalized.",
      placeHolder: "https://your-ollama-server.example",
      value: getBridgeConfig().baseUrl,
      ignoreFocusOut: true
    });

    if (value === undefined) {
      return;
    }

    baseUrl = normalizeUserBaseUrl(value);
    keyMode = "optional";
  }

  if (selected.mode === "custom") {
    const value = await vscode.window.showInputBox({
      title: "OpenAI-Compatible Path",
      prompt: "Use /v1 for Ollama-compatible OpenAI endpoints unless your provider requires another path.",
      value: getBridgeConfig().openaiCompatiblePath,
      ignoreFocusOut: true
    });

    if (value === undefined) {
      return;
    }

    openaiPath = normalizeUserPath(value);
  }

  if (selected.mode === "remote") {
    const requiresKey = await vscode.window.showQuickPick(
      [
        {
          label: "No API key",
          description: "Use this when the remote Ollama server is already protected another way",
          value: false
        },
        {
          label: "Use API key",
          description: "Send Authorization: Bearer <key> to the remote endpoint",
          value: true
        }
      ],
      {
        title: "Remote Authentication",
        placeHolder: "Does this endpoint require an API key?"
      }
    );

    if (!requiresKey) {
      return;
    }

    keyMode = requiresKey.value ? "optional" : "none";
  }

  if (keyMode === "required" || keyMode === "optional") {
    const storedKey = await promptForApiKey(keyMode);

    if (storedKey === undefined) {
      return;
    }

    await secrets.setApiKey(storedKey, connectionId);
  } else {
    // Local Ollama does not need bearer auth; clearing avoids accidentally sending a stale key to localhost.
    await secrets.clearApiKey(connectionId);
  }

  const current = getBridgeConfig();
  const updatedConnections = upsertConnection(current.connections, {
    id: connectionId,
    label: connectionLabel,
    type: selected.mode,
    enabled: true,
    primary: selected.mode === "cloud" || current.connections.length === 0,
    baseUrl,
    openaiCompatiblePath: openaiPath,
    requiresApiKey: keyMode !== "none"
  });
  const primary = updatedConnections.find((connection) => connection.primary) ?? updatedConnections[0];

  await config.update("connections", updatedConnections, vscode.ConfigurationTarget.Global);
  await config.update("connectionMode", primary.type, vscode.ConfigurationTarget.Global);
  await config.update("baseUrl", primary.baseUrl, vscode.ConfigurationTarget.Global);
  await config.update("openaiCompatiblePath", primary.openaiCompatiblePath, vscode.ConfigurationTarget.Global);

  provider.refresh();

  const testNow = await vscode.window.showInformationMessage(
    `Ollama Bridge configured for ${selected.mode}: ${baseUrl}`,
    "Test Connection",
    "Later"
  );

  if (testNow === "Test Connection") {
    await testConnection(client);
  }
}

function upsertConnection(
  connections: Array<{
    id: string;
    label: string;
    type: string;
    enabled: boolean;
    primary: boolean;
    baseUrl: string;
    openaiCompatiblePath: string;
    requiresApiKey: boolean;
  }>,
  connection: {
    id: string;
    label: string;
    type: string;
    enabled: boolean;
    primary: boolean;
    baseUrl: string;
    openaiCompatiblePath: string;
    requiresApiKey: boolean;
  }
): typeof connections {
  const existing = connections.filter((candidate) => candidate.id !== connection.id);
  const hasPrimary = existing.some((candidate) => candidate.primary);
  const nextConnection = {
    ...connection,
    primary: connection.primary || !hasPrimary
  };

  if (nextConnection.primary) {
    return [
      ...existing.map((candidate) => ({ ...candidate, primary: false })),
      nextConnection
    ];
  }

  return [...existing, nextConnection];
}

async function promptForApiKey(mode: "required" | "optional"): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: "Ollama API Key",
    prompt:
      mode === "required"
        ? "Enter your Ollama Cloud API key."
        : "Enter an API key if this endpoint needs bearer auth. Leave empty to clear it.",
    password: true,
    ignoreFocusOut: true
  });

  return value;
}

async function refreshModels(client: OllamaClient, provider: OllamaLanguageModelProvider): Promise<void> {
  provider.refresh();
  const models = await client.listModels({ forceRefresh: true });
  provider.refresh();
  void vscode.window.showInformationMessage(`Ollama models refreshed: ${models.length} found.`);
}

async function testConnection(client: OllamaClient): Promise<void> {
  try {
    await warnIfCloudKeyIsMissing(client);
    const models = await client.listModels({ forceRefresh: true });
    const suffix = models.length === 1 ? "model" : "models";
    void vscode.window.showInformationMessage(`Connected to Ollama: ${models.length} ${suffix} found.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not connect to Ollama: ${formatError(error)}`);
  }
}

async function showDiagnostics(client: OllamaClient, output: vscode.OutputChannel): Promise<void> {
  const config = getBridgeConfig();
  const diagnostics = client.getDiagnostics();
  const hasApiKey = await client.hasApiKey();

  output.appendLine("");
  output.appendLine("Ollama Copilot Bridge Diagnostics");
  output.appendLine(`Time: ${new Date().toISOString()}`);
  output.appendLine(`Enabled: ${config.enabled}`);
  output.appendLine(`Connection mode: ${config.connectionMode}`);
  output.appendLine(`Base URL: ${config.baseUrl}`);
  output.appendLine(`OpenAI path: ${config.openaiCompatiblePath}`);
  output.appendLine(`API key: ${hasApiKey ? "set" : "missing"}`);
  output.appendLine(`Cache TTL: ${config.modelCacheTtlMs}ms`);
  output.appendLine(`Metadata concurrency: ${config.metadataConcurrency}`);
  output.appendLine(`Pinned models: ${config.pinnedModels.join(", ") || "-"}`);
  output.appendLine(`Hidden models: ${config.hiddenModels.join(", ") || "-"}`);
  output.appendLine(`Vision models: ${config.visionModels.join(", ") || "-"}`);
  output.appendLine("Connections:");
  for (const connection of config.connections) {
    output.appendLine(
      `- ${connection.label} (${connection.id}) type=${connection.type} primary=${connection.primary} enabled=${connection.enabled} baseUrl=${connection.baseUrl} apiKey=${connection.requiresApiKey ? "required/optional" : "not required"}`
    );
  }
  output.appendLine(`Last model source: ${diagnostics.lastModelSource ?? "-"}`);
  output.appendLine(`Last model count: ${diagnostics.lastModelCount ?? "-"}`);
  output.appendLine(`Last model discovery: ${formatMs(diagnostics.lastModelDiscoveryMs)}`);
  output.appendLine(`Last metadata enrich: ${formatMs(diagnostics.lastMetadataMs)}`);
  output.appendLine(`Last metadata successes: ${diagnostics.lastMetadataSuccesses ?? "-"}`);
  output.appendLine(`Last metadata failures: ${diagnostics.lastMetadataFailures ?? "-"}`);
  output.appendLine(`Last chat model: ${diagnostics.lastChatModel ?? "-"}`);
  output.appendLine(`Last chat first token: ${formatMs(diagnostics.lastChatTimeToFirstTokenMs)}`);
  output.appendLine(`Last chat duration: ${formatMs(diagnostics.lastChatDurationMs)}`);
  output.appendLine(`Last chat characters: ${diagnostics.lastChatCharacters ?? "-"}`);
  output.appendLine(`Last chat tool calls: ${diagnostics.lastChatToolCalls ?? "-"}`);
  output.appendLine(`Last retry count: ${diagnostics.lastRetryCount ?? "-"}`);
  output.appendLine(`Last error: ${diagnostics.lastError ?? "-"}`);
  output.show(true);
}

async function warnIfCloudKeyIsMissing(client: OllamaClient): Promise<void> {
  const config = getBridgeConfig();
  const isCloud = config.connectionMode === "cloud" || /^https:\/\/ollama\.com\/?$/i.test(config.baseUrl);

  if (isCloud && !(await client.hasApiKey())) {
    void vscode.window.showWarningMessage(
      "Ollama Cloud needs an API key. Run 'Ollama Copilot: Set API Key' before sending requests."
    );
  }
}

function normalizeUserBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const knownSuffixes = ["/api/tags", "/api/show", "/api/chat", "/v1/models", "/v1/chat/completions"];

  for (const suffix of knownSuffixes) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length).replace(/\/+$/, "");
    }
  }

  return trimmed;
}

function normalizeUserPath(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function normalizeConnectionId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "-") || "connection";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "-" : `${value}ms`;
}

function buildIdleStatusTooltip(): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.supportHtml = false;
  tooltip.appendMarkdown("**Ollama Copilot Bridge**\n\n");
  tooltip.appendMarkdown("No chat request has been tracked yet.\n\n");
  tooltip.appendMarkdown("Use an Ollama Bridge model in Copilot Chat to see context usage here.");
  return tooltip;
}

function buildContextStatusTooltip(snapshot: ContextUsageSnapshot): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  const used = formatTokenCount(snapshot.inputTokens);
  const limit = formatTokenCount(snapshot.maxInputTokens);
  const output = formatTokenCount(snapshot.outputTokens);
  const total = formatTokenCount(snapshot.totalTokens);
  const updatedAt = snapshot.updatedAt.toLocaleTimeString();

  tooltip.supportHtml = false;
  tooltip.appendMarkdown(`**Ollama Bridge: ${snapshot.modelName}**\n\n`);
  tooltip.appendMarkdown(`Context Window\n\n${renderUsageBar(snapshot.inputPercent)} **${snapshot.inputPercent}% used**\n\n`);
  tooltip.appendMarkdown(`| Metric | Value |\n| --- | ---: |\n`);
  tooltip.appendMarkdown(`| Input context | ${used} / ${limit} |\n`);
  tooltip.appendMarkdown(`| Response estimate | ${output} |\n`);
  tooltip.appendMarkdown(`| Last request total | ${total} |\n`);
  tooltip.appendMarkdown(`| Max output | ${formatTokenCount(snapshot.maxOutputTokens)} |\n`);
  tooltip.appendMarkdown(`| Request multiplier | ${snapshot.requestMultiplier}x |\n`);
  tooltip.appendMarkdown(`| Updated | ${updatedAt} |\n\n`);
  tooltip.appendMarkdown("Click to manage API key, test connection, or refresh models.");

  return tooltip;
}

function renderUsageBar(percent: number): string {
  const width = 18;
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)));
  return `[${"=".repeat(filled)}${"-".repeat(width - filled)}]`;
}
