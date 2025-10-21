import * as fs from "fs/promises";
import * as path from "path";
import { Disposable, ExtensionContext, Uri, ViewColumn, Webview, WebviewPanel, window, workspace } from "vscode";
import { ActionDefinition, ActionEnvironmentVariable, ActionExecutionResult } from "../actions/actionTypes";
import { ActionExecutor } from "../execution/actionExecutor";
import {
  ActionEditorDraft,
  ActionEditorAvailableAction,
  ExtensionMessage,
  LoadedActionDraft,
  WebviewMessage,
  ActionEditorEnvVariable,
  ActionEditorParameter,
  ActionEditorChainLink,
} from "./types";

interface InitPayload {
  readonly action?: LoadedActionDraft;
  readonly predefinedVariables: readonly { name: string; description: string }[];
  readonly availableActions: readonly ActionEditorAvailableAction[];
}

export class ActionEditorProvider {
  private currentPanel: WebviewPanel | undefined;
  private loadedAction: ActionDefinition | undefined;
  private tester?: (draft: ActionEditorDraft, baseAction: ActionDefinition | undefined) => Promise<ActionExecutionResult>;

  constructor(
    private readonly context: ExtensionContext,
    private readonly executor: ActionExecutor,
    private readonly actionsSupplier: () => Promise<readonly ActionDefinition[]>,
  ) {}

  setTester(tester: (draft: ActionEditorDraft, baseAction: ActionDefinition | undefined) => Promise<ActionExecutionResult>): void {
    this.tester = tester;
  }

  async showEditor(action?: ActionDefinition): Promise<ActionEditorDraft | undefined> {
    this.loadedAction = action;
    const initPayload = await this.createInitPayload(action);

    if (this.currentPanel) {
      const existingPanel = this.currentPanel;
      existingPanel.title = action ? `Edit Action: ${action.name}` : "New Snip It Action";
      existingPanel.reveal(ViewColumn.One);
      await this.postMessage(existingPanel.webview, { type: "focus" });
      await this.postMessage(existingPanel.webview, { type: "init", payload: initPayload });
      return undefined;
    }

    const panel = window.createWebviewPanel(
      "snipIt.actionEditor",
      action ? `Edit Action: ${action.name}` : "New Snip It Action",
      ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.getMediaRoot()]
      },
    );

    this.currentPanel = panel;

    panel.webview.html = await this.renderHtml(panel.webview);

    return await new Promise<ActionEditorDraft | undefined>(resolve => {
      const disposables: Disposable[] = [];
      const sendInit = async () => {
        await this.postMessage(panel.webview, { type: "init", payload: initPayload });
      };

      const cleanup = (result?: ActionEditorDraft) => {
        for (const disposable of disposables) {
          disposable.dispose();
        }

        if (this.currentPanel === panel) {
          this.currentPanel = undefined;
        }

        this.loadedAction = undefined;

        resolve(result);
        panel.dispose();
      };

      disposables.push(
        panel.webview.onDidReceiveMessage(async message => {
          const incoming = message as WebviewMessage;

          if (incoming.type === "ready") {
            await sendInit();
            return;
          }

          if (incoming.type === "selectRootDirectory") {
            await this.handleRootDirectoryRequest(panel);
            return;
          }

          if (incoming.type === "test") {
            await this.handleTest(panel, incoming.payload);
            return;
          }

          if (incoming.type === "save") {
            cleanup(incoming.payload);
            return;
          }

          if (incoming.type === "cancel") {
            cleanup();
            return;
          }
        }),
        panel.onDidDispose(() => cleanup()),
      );

      void sendInit();
    });
  }

  private getMediaRoot(): Uri {
    return Uri.joinPath(this.context.extensionUri, "media", "action-editor");
  }

  private async renderHtml(webview: Webview): Promise<string> {
    const mediaRoot = this.getMediaRoot();
    const manifest = await this.loadManifest(mediaRoot);
    const entry = manifest["src/main.tsx"] ?? Object.values(manifest)[0];

    if (!entry) {
      throw new Error("Unable to locate webview entry file. Run `npm run build:webview` first.");
    }

    const scriptUri = webview.asWebviewUri(Uri.joinPath(mediaRoot, entry.file));
    const cssUris = (entry.css ?? []).map(css => webview.asWebviewUri(Uri.joinPath(mediaRoot, css)));

    const nonce = generateNonce();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `script-src 'nonce-${nonce}'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
    ].join("; ");

    const styles = cssUris
      .map(uri => `<link rel="stylesheet" href="${uri}">`)
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Snip It Action Editor</title>
${styles}
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private async handleTest(panel: WebviewPanel, draft: ActionEditorDraft): Promise<void> {
    if (!this.tester) {
      await this.postMessage(panel.webview, {
        type: "testResult",
        payload: { success: false, message: "Testing is not available." },
      });
      return;
    }

    try {
      const result = await this.tester(draft, this.loadedAction);
      await this.postMessage(panel.webview, {
        type: "testResult",
        payload: {
          success: true,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
        },
      });
    } catch (error) {
      await this.postMessage(panel.webview, {
        type: "testResult",
        payload: {
          success: false,
          message: (error as Error).message,
        },
      });
    }
  }

  private async handleRootDirectoryRequest(panel: WebviewPanel): Promise<void> {
    const defaultUri = this.getRootDirectoryDefaultUri();
    const selection = await window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select action root directory",
      defaultUri,
    });

    if (!selection || selection.length === 0) {
      return;
    }

    await this.postMessage(panel.webview, {
      type: "rootDirectorySelected",
      payload: { value: selection[0]!.fsPath },
    });
  }

  private async loadManifest(mediaRoot: Uri): Promise<Record<string, { file: string; css?: string[] }>> {
    const candidates = [
      path.join(mediaRoot.fsPath, ".vite", "manifest.json"),
      path.join(mediaRoot.fsPath, "manifest.json"),
    ];

    for (const candidate of candidates) {
      try {
        const raw = await fs.readFile(candidate, "utf8");
        return JSON.parse(raw) as Record<string, { file: string; css?: string[] }>;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }

    throw new Error("Unable to locate webview manifest. Run `npm run build:webview`.");
  }

  private async createInitPayload(action?: ActionDefinition): Promise<InitPayload> {
    const actions = await this.actionsSupplier();
    return {
      action: action ? convertActionToDraft(action) : undefined,
      predefinedVariables: this.executor.getPredefinedVariables(),
      availableActions: actions.map(item => ({ id: item.id, name: item.name })),
    };
  }

  private async postMessage(webview: Webview, message: ExtensionMessage): Promise<void> {
    if (!this.currentPanel || this.currentPanel.webview !== webview) {
      return;
    }

    try {
      await webview.postMessage(message);
    } catch (error) {
      console.warn(`[Snip It] Unable to send action editor message "${message.type}"`, error);
    }
  }

  private getRootDirectoryDefaultUri(): Uri | undefined {
    const existing = this.loadedAction?.workingDirectory;
    if (existing) {
      try {
        return Uri.file(existing);
      } catch {
        // ignore invalid paths and fall back to workspace root
      }
    }

    return workspace.workspaceFolders?.[0]?.uri;
  }
}

function convertActionToDraft(action: ActionDefinition): LoadedActionDraft {
  return {
    id: action.id,
    name: action.name,
    description: action.description,
    tags: action.tags,
    language: action.language,
    script: action.script,
    env: action.env.map(convertEnvVariable),
    parameters: action.parameters.map(convertParameter),
    runInOutputChannel: action.runInOutputChannel,
    chain: action.chain ? action.chain.map(convertChainLink) : [],
    workingDirectory: action.workingDirectory,
  };
}

function convertEnvVariable(variable: ActionEnvironmentVariable): ActionEditorEnvVariable {
  return {
    key: variable.key,
    value: variable.fromSecret ? undefined : variable.value,
    fromSecret: variable.fromSecret,
    secretKey: variable.secretKey,
    secretValue: undefined,
  };
}

function convertParameter(parameter: ActionDefinition["parameters"][number]): ActionEditorParameter {
  return {
    name: parameter.name,
    prompt: parameter.prompt,
    defaultValue: parameter.defaultValue,
    required: parameter.required,
  };
}

function convertChainLink(link: NonNullable<ActionDefinition["chain"]>[number]): ActionEditorChainLink {
  return {
    targetActionId: link.targetActionId,
    passOutputAs: link.passOutputAs,
  };
}

function generateNonce(): string {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
