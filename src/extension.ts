import * as vscode from "vscode";
import { affectsBridgeConfig, getBridgeConfig } from "./config";
import { OllamaClient } from "./ollamaClient";
import { OllamaLanguageModelProvider } from "./provider";
import { SecretStore } from "./secrets";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel("Ollama Copilot Bridge");
  const secrets = new SecretStore(context.secrets);
  const client = new OllamaClient(secrets);
  const provider = new OllamaLanguageModelProvider(client, output);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 72);

  status.command = "ollamaCopilot.manage";
  status.text = "$(cloud) Ollama Bridge";
  status.tooltip = "Manage Ollama Copilot Bridge";
  status.show();

  context.subscriptions.push(
    output,
    status,
    {
      dispose: () => provider.refresh()
    },
    vscode.lm.registerLanguageModelChatProvider("ollama-bridge", provider),
    vscode.commands.registerCommand("ollamaCopilot.manage", () => manageBridge(client, secrets, provider)),
    vscode.commands.registerCommand("ollamaCopilot.setApiKey", () => setApiKey(secrets)),
    vscode.commands.registerCommand("ollamaCopilot.clearApiKey", () => clearApiKey(secrets)),
    vscode.commands.registerCommand("ollamaCopilot.refreshModels", () => refreshModels(client, provider)),
    vscode.commands.registerCommand("ollamaCopilot.testConnection", () => testConnection(client)),
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
  provider: OllamaLanguageModelProvider
): Promise<void> {
  const config = getBridgeConfig();
  const selected = await vscode.window.showQuickPick(
    [
      {
        label: "$(key) Set API Key",
        detail: "Stored securely with VS Code SecretStorage",
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
      await setApiKey(secrets);
      break;
    case "clearApiKey":
      await clearApiKey(secrets);
      break;
    case "refresh":
      await refreshModels(client, provider);
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

async function setApiKey(secrets: SecretStore): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: "Ollama API Key",
    prompt: "Enter your Ollama Cloud API key. Leave empty to clear it.",
    password: true,
    ignoreFocusOut: true
  });

  if (value === undefined) {
    return;
  }

  await secrets.setApiKey(value);
  void vscode.window.showInformationMessage(value.trim() ? "Ollama API key saved." : "Ollama API key cleared.");
}

async function refreshModels(client: OllamaClient, provider: OllamaLanguageModelProvider): Promise<void> {
  provider.refresh();
  const models = await client.listModels();
  provider.refresh();
  void vscode.window.showInformationMessage(`Ollama models refreshed: ${models.length} found.`);
}

async function testConnection(client: OllamaClient): Promise<void> {
  try {
    await warnIfCloudKeyIsMissing(client);
    const models = await client.listModels();
    const suffix = models.length === 1 ? "model" : "models";
    void vscode.window.showInformationMessage(`Connected to Ollama: ${models.length} ${suffix} found.`);
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not connect to Ollama: ${formatError(error)}`);
  }
}

async function warnIfCloudKeyIsMissing(client: OllamaClient): Promise<void> {
  const config = getBridgeConfig();
  const isCloud = /^https:\/\/ollama\.com\/?$/i.test(config.baseUrl);

  if (isCloud && !(await client.hasApiKey())) {
    void vscode.window.showWarningMessage(
      "Ollama Cloud needs an API key. Run 'Ollama Copilot: Set API Key' before sending requests."
    );
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
