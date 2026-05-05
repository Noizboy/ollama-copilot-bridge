import * as vscode from "vscode";
import { affectsBridgeConfig, getBridgeConfig } from "./config";
import {
  cloudConnectionId,
  createCloudConnection,
  createEndpointConnection,
  endpointConnectionId,
  normalizeEndpointBaseUrl,
  removeBridgeConnection,
  toStoredConnection,
  upsertBridgeConnection,
  type ConnectionSlot,
  type StoredBridgeConnectionConfig
} from "./connectionSlots";
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
    vscode.commands.registerCommand("ollamaCopilot.setApiKey", () => configureConnection(client, secrets, provider, "cloud")),
    vscode.commands.registerCommand("ollamaCopilot.clearApiKey", () => disconnectFromCommand(secrets, provider)),
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
  type ManageItem = vscode.QuickPickItem & {
    action: "connectCloud" | "connectEndpoint" | "disconnect" | "test" | "refresh" | "diagnostics" | "connected";
    slot?: ConnectionSlot;
  };
  const cloud = config.connections.find((connection) => connection.id === cloudConnectionId);
  const endpoint = config.connections.find((connection) => connection.id === endpointConnectionId);
  const hasConnections = config.connections.length > 0;

  const items: ManageItem[] = [];
  if (cloud) {
    items.push({
      label: "$(cloud) Ollama API",
      description: "Connected",
      detail: cloud.baseUrl,
      action: "connected",
      slot: cloudConnectionId
    });
  } else {
    items.push({
      label: "$(cloud) Connect Ollama API",
      detail: "Use an Ollama API key from ollama.com",
      action: "connectCloud"
    });
  }

  if (endpoint) {
    items.push({
      label: endpoint.type === "local" ? "$(device-desktop) Localhost" : "$(server) VPS URL",
      description: "Connected",
      detail: endpoint.baseUrl,
      action: "connected",
      slot: endpointConnectionId
    });
  } else {
    items.push({
      label: "$(link) Connect Localhost / VPS URL",
      detail: "Use http://localhost:11434 or a custom VPS URL",
      action: "connectEndpoint"
    });
  }

  if (hasConnections) {
    items.push({
      label: "$(plug) Disconnect",
      detail: "Disconnect Ollama API or Localhost/VPS",
      action: "disconnect"
    });
  }

  items.push(
    {
      label: "$(testing-run-icon) Test Connection",
      detail: config.connections.map((connection) => connection.label).join(", "),
      action: "test"
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
  );

  await new Promise<void>((resolve) => {
    const quickPick = vscode.window.createQuickPick<ManageItem>();
    quickPick.title = "Ollama Copilot Bridge";
    quickPick.placeholder = "Connect, test, or disconnect one of the two supported slots";
    quickPick.items = items;
    quickPick.onDidAccept(async () => {
      const selected = quickPick.selectedItems[0];
      quickPick.hide();

      if (!selected) {
        return;
      }

      switch (selected.action) {
        case "connectCloud":
          await configureConnection(client, secrets, provider, "cloud");
          break;
        case "connectEndpoint":
          await configureConnection(client, secrets, provider, "endpoint");
          break;
        case "disconnect":
          await disconnectFromCommand(secrets, provider);
          break;
        case "test":
          await testConnection(client);
          break;
        case "refresh":
          await refreshModels(client, provider);
          break;
        case "diagnostics":
          await showDiagnostics(client, output);
          break;
        case "connected":
          break;
      }
    });
    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve();
    });
    quickPick.show();
  });
}

async function disconnectFromCommand(
  secrets: SecretStore,
  provider: OllamaLanguageModelProvider
): Promise<void> {
  const connections = getBridgeConfig().connections;
  const selected = await vscode.window.showQuickPick(
    connections.map((connection): vscode.QuickPickItem & { slot: ConnectionSlot } => ({
      label: connection.label,
      detail: connection.baseUrl,
      slot: connection.id === cloudConnectionId ? cloudConnectionId : endpointConnectionId
    })),
    {
      title: "Disconnect Ollama Bridge",
      placeHolder: "Choose a connection to disconnect"
    }
  );

  if (!selected) {
    return;
  }

  await disconnectConnection(selected.slot, secrets, provider);
}

async function disconnectConnection(
  slot: ConnectionSlot,
  secrets: SecretStore,
  provider: OllamaLanguageModelProvider
): Promise<void> {
  const label = slot === cloudConnectionId ? "Ollama API" : "Localhost / VPS URL";
  const confirmation = await vscode.window.showWarningMessage(
    `Disconnect ${label}?`,
    { modal: true },
    "Disconnect"
  );

  if (confirmation !== "Disconnect") {
    return;
  }

  const config = getBridgeConfig();
  const workspaceConfig = vscode.workspace.getConfiguration(configSection);
  const updatedConnections = removeBridgeConnection(config.connections.map(toStoredConnection), slot);
  await secrets.clearApiKey(slot);
  await workspaceConfig.update("connections", updatedConnections, vscode.ConfigurationTarget.Global);

  const primary = updatedConnections[0];
  if (primary) {
    await workspaceConfig.update("connectionMode", primary.type, vscode.ConfigurationTarget.Global);
    await workspaceConfig.update("baseUrl", primary.baseUrl, vscode.ConfigurationTarget.Global);
    await workspaceConfig.update("openaiCompatiblePath", primary.openaiCompatiblePath, vscode.ConfigurationTarget.Global);
  } else {
    await workspaceConfig.update("enabled", false, vscode.ConfigurationTarget.Global);
    await workspaceConfig.update("connectionMode", "cloud", vscode.ConfigurationTarget.Global);
    await workspaceConfig.update("baseUrl", "https://ollama.com", vscode.ConfigurationTarget.Global);
    await workspaceConfig.update("openaiCompatiblePath", "/v1", vscode.ConfigurationTarget.Global);
  }

  provider.refresh();
  void vscode.window.showInformationMessage(`${label} disconnected.`);
}

async function configureConnection(
  client: OllamaClient,
  secrets: SecretStore,
  provider: OllamaLanguageModelProvider,
  slot?: ConnectionSlot
): Promise<void> {
  const selectedSlot = slot ?? await pickConnectionSlot();

  if (!selectedSlot) {
    return;
  }

  const config = vscode.workspace.getConfiguration(configSection);
  let connection: StoredBridgeConnectionConfig;

  if (selectedSlot === cloudConnectionId) {
    const storedKey = await promptForApiKey();

    if (storedKey === undefined) {
      return;
    }

    await secrets.setApiKey(storedKey, cloudConnectionId);
    connection = createCloudConnection();
  } else {
    const value = await vscode.window.showInputBox({
      title: "Localhost or VPS URL",
      prompt: "Use http://localhost:11434 or paste your VPS/custom Ollama URL.",
      placeHolder: "http://localhost:11434",
      value: getBridgeConfig().connections.find((item) => item.id === endpointConnectionId)?.baseUrl ?? "http://localhost:11434",
      ignoreFocusOut: true
    });

    if (value === undefined) {
      return;
    }

    connection = createEndpointConnection(normalizeEndpointBaseUrl(value));
    await secrets.clearApiKey(endpointConnectionId);
  }

  const current = getBridgeConfig();
  const updatedConnections = upsertBridgeConnection(current.connections.map(toStoredConnection), connection);
  const primary = updatedConnections.find((connection) => connection.primary) ?? updatedConnections[0];

  await config.update("enabled", true, vscode.ConfigurationTarget.Global);
  await config.update("connections", updatedConnections, vscode.ConfigurationTarget.Global);
  await config.update("connectionMode", primary.type, vscode.ConfigurationTarget.Global);
  await config.update("baseUrl", primary.baseUrl, vscode.ConfigurationTarget.Global);
  await config.update("openaiCompatiblePath", primary.openaiCompatiblePath, vscode.ConfigurationTarget.Global);

  provider.refresh();

  const testNow = await vscode.window.showInformationMessage(
    `Ollama Bridge configured: ${connection.label}`,
    "Test Connection",
    "Later"
  );

  if (testNow === "Test Connection") {
    await testConnection(client);
  }
}

async function pickConnectionSlot(): Promise<ConnectionSlot | undefined> {
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: "$(cloud) Ollama API",
        description: "Connect with an API key",
        slot: cloudConnectionId
      },
      {
        label: "$(link) Localhost / VPS URL",
        description: "Connect with a local or custom URL",
        slot: endpointConnectionId
      }
    ] satisfies Array<vscode.QuickPickItem & { slot: ConnectionSlot }>,
    {
      title: "Ollama Copilot Bridge Connection",
      placeHolder: "Choose one of the two supported connection slots"
    }
  );

  return selected?.slot;
}

async function promptForApiKey(): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: "Ollama API Key",
    prompt: "Enter your Ollama API key.",
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
  const isCloud = config.connections.some((connection) => connection.id === cloudConnectionId);

  if (isCloud && !(await client.hasApiKey())) {
    void vscode.window.showWarningMessage(
      "Ollama Cloud needs an API key. Run 'Ollama Copilot: Set API Key' before sending requests."
    );
  }
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
