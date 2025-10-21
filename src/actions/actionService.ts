import { randomUUID } from "crypto";
import * as path from "path";
import { Disposable, ExtensionContext, QuickPickItem, TextEditor, Uri, env, window, workspace } from "vscode";
import {
  ActionDefinition,
  ActionEnvironmentVariable,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionParameter,
  ActionChainLink,
} from "./actionTypes";
import { ActionStore } from "./actionStore";
import { ActionTreeDataProvider } from "./actionTreeDataProvider";
import { ActionExecutor } from "../execution/actionExecutor";
import { SecretManager } from "../secrets/secretManager";
import { setContextKey } from "../utils/contextKeys";
import { ActionEditorProvider } from "../webview/actionEditorProvider";
import {
  ActionEditorDraft,
  ActionEditorEnvVariable,
  ActionEditorParameter,
  ActionEditorChainLink,
} from "../webview/types";

const CONTEXT_HAS_ACTIONS = "snipIt.hasActions";

export class ActionService implements Disposable {
  private readonly disposables: Disposable[] = [];
  private activeActions: readonly ActionDefinition[] = [];

  constructor(
    private readonly context: ExtensionContext,
    private readonly store: ActionStore,
    private readonly tree: ActionTreeDataProvider,
    private readonly secretManager: SecretManager,
    private readonly executor: ActionExecutor,
    private readonly editorProvider: ActionEditorProvider,
  ) {
    this.disposables.push(this.store.onDidChange(actions => this.handleStoreUpdate(actions)));
    this.editorProvider.setTester((draft, baseAction) => this.testDraft(draft, baseAction));
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    const actions = await this.store.getAll();
    this.applyActions(actions);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    this.store.dispose();
  }

  getTreeProvider(): ActionTreeDataProvider {
    return this.tree;
  }

  hasActions(): boolean {
    return this.activeActions.length > 0;
  }

  async refresh(): Promise<void> {
    await this.store.initialize();
  }

  async createAction(): Promise<void> {
    const draft = await this.editorProvider.showEditor();
    if (!draft) {
      return;
    }

    if (!draft.name.trim()) {
      window.showWarningMessage("Action name is required.");
      return;
    }

    const now = new Date().toISOString();
    const actionId = randomUUID();
    const action: ActionDefinition = {
      id: actionId,
      createdAt: now,
      updatedAt: now,
      name: draft.name.trim(),
      description: draft.description?.trim(),
      tags: draft.tags.map(tag => tag.trim()).filter(Boolean),
      language: draft.language,
      script: draft.script,
      env: await this.transformEnvVariables(actionId, draft.env),
      parameters: draft.parameters
        .filter(parameter => parameter.name.trim().length > 0)
        .map((parameter: ActionEditorParameter): ActionParameter => ({
          ...parameter,
          name: parameter.name.trim(),
        })),
      workingDirectory: this.normalizeWorkingDirectory(draft.workingDirectory),
      runInOutputChannel: !!draft.runInOutputChannel,
      chain: draft.chain?.map((link: ActionEditorChainLink): ActionChainLink => ({ ...link })) ?? [],
    };

    await this.store.save(action);
    window.showInformationMessage(`Created action \"${action.name}\"`);
  }

  async editAction(actionId: string): Promise<void> {
    const action = this.activeActions.find(item => item.id === actionId);
    if (!action) {
      window.showWarningMessage("Action not found.");
      return;
    }

    const updated = await this.editorProvider.showEditor(action);
    if (!updated) {
      return;
    }

    if (!updated.name.trim()) {
      window.showWarningMessage("Action name is required.");
      return;
    }

    const next: ActionDefinition = {
      ...action,
      updatedAt: new Date().toISOString(),
    name: updated.name.trim(),
    description: updated.description?.trim(),
    tags: updated.tags.map(tag => tag.trim()).filter(Boolean),
      language: updated.language,
      script: updated.script,
      parameters: updated.parameters
        .filter(parameter => parameter.name.trim().length > 0)
        .map((parameter: ActionEditorParameter): ActionParameter => ({
          ...parameter,
          name: parameter.name.trim(),
        })),
      workingDirectory: this.normalizeWorkingDirectory(updated.workingDirectory),
      runInOutputChannel: !!updated.runInOutputChannel,
    chain: updated.chain?.map((link: ActionEditorChainLink): ActionChainLink => ({ ...link })) ?? [],
      env: await this.transformEnvVariables(action.id, updated.env),
    };

    await this.store.save(next);
    window.showInformationMessage(`Updated action \"${next.name}\"`);
  }

  async deleteAction(actionId: string): Promise<void> {
    const action = this.activeActions.find(item => item.id === actionId);
    if (!action) {
      return;
    }

    const answer = await window.showWarningMessage(
      `Delete action \"${action.name}\"?`,
      { modal: true },
      "Delete",
    );

    if (answer !== "Delete") {
      return;
    }

    await Promise.all(
      action.env
        .filter(variable => variable.fromSecret && variable.secretKey)
        .map(variable => this.secretManager.deleteSecret(variable.secretKey!)),
    );

    await this.store.delete(actionId);
    window.showInformationMessage(`Action \"${action.name}\" deleted.`);
  }

  async runAction(actionId: string, contextOverrides?: Partial<ActionExecutionContext>): Promise<void> {
    const action = this.activeActions.find(item => item.id === actionId);
    if (!action) {
      window.showWarningMessage("Action not found.");
      return;
    }

    const context = await this.buildExecutionContext(contextOverrides);
    try {
      const result = await this.executor.execute(action, context);

      if (result.exitCode === 0) {
        await this.runChainedActions(action, result, context);
        window.showInformationMessage(`Action "${action.name}" completed successfully.`);
      } else {
        window.showWarningMessage(`Action "${action.name}" exited with code ${result.exitCode ?? 0}.`);
      }
    } catch (error) {
      window.showErrorMessage(`Failed to run action "${action.name}": ${(error as Error).message}`);
    }
  }

  async showActionPicker(contextOverrides?: Partial<ActionExecutionContext>): Promise<void> {
    if (this.activeActions.length === 0) {
      window.showInformationMessage("No Snip It actions found. Create one first.");
      return;
    }

    const items = [...this.activeActions]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map<QuickPickItem & { id: string }>(action => ({
  label: action.name,
  description: action.tags.join(", "),
  detail: action.description,
  id: action.id,
      }));

    const selection = await window.showQuickPick(items, {
      placeHolder: "Select a Snip It action",
      matchOnDetail: true,
      matchOnDescription: true,
    });

    if (!selection) {
      return;
    }

    await this.runAction(selection.id, contextOverrides);
  }

  async importActions(): Promise<void> {
    const result = await window.showOpenDialog({
      title: "Import Snip It actions",
      canSelectMany: false,
      filters: { "Snip It": ["json"] },
    });

    if (!result || result.length === 0) {
      return;
    }

    const fileUri = result[0];
    const content = await workspace.fs.readFile(fileUri);

    try {
      const parsed = JSON.parse(Buffer.from(content).toString("utf8"));

      if (!Array.isArray(parsed)) {
        throw new Error("The selected file does not contain a list of actions.");
      }

      const existing = await this.store.getAll();
      const usedIds = new Set(existing.map(action => action.id));
      const now = new Date().toISOString();
      const imported: ActionDefinition[] = [];
      const idMap = new Map<string, string>();
      const candidates: ActionDefinition[] = [];

      for (const candidate of parsed) {
        if (!candidate || typeof candidate !== "object") {
          continue;
        }

        candidates.push(candidate as ActionDefinition);
      }

      const idOccurrences = new Map<string, number>();
      for (const candidate of candidates) {
        if (typeof candidate.id === "string" && candidate.id.trim().length > 0) {
          const key = candidate.id.trim();
          idOccurrences.set(key, (idOccurrences.get(key) ?? 0) + 1);
        }
      }

      const queue: Array<{ candidate: ActionDefinition; newId: string }> = [];

      for (const candidate of candidates) {
        const originalId = typeof candidate.id === "string" && candidate.id.trim().length > 0 ? candidate.id.trim() : undefined;
        const isDuplicate = originalId ? (idOccurrences.get(originalId) ?? 0) > 1 : false;
        let actionId = originalId;

        if (!actionId || usedIds.has(actionId) || isDuplicate) {
          actionId = randomUUID();
        }

        if (originalId && !idMap.has(originalId)) {
          idMap.set(originalId, actionId);
        }

        usedIds.add(actionId);
        queue.push({ candidate, newId: actionId });
      }

      for (const entry of queue) {
        const candidate = entry.candidate;
        const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : now;
        const updatedAt = typeof candidate.updatedAt === "string" ? candidate.updatedAt : createdAt;
        const chain: ActionChainLink[] = [];

        if (Array.isArray(candidate.chain)) {
          for (const rawLink of candidate.chain) {
            if (!rawLink || typeof rawLink !== "object" || typeof rawLink.targetActionId !== "string") {
              continue;
            }

            const typedLink = rawLink as ActionChainLink;
            chain.push({
              ...typedLink,
              targetActionId: idMap.get(typedLink.targetActionId) ?? typedLink.targetActionId,
            });
          }
        }

        imported.push({
          ...candidate,
          id: entry.newId,
          createdAt,
          updatedAt,
          chain,
        });
      }

      if (imported.length === 0) {
        window.showWarningMessage("No valid Snip It actions found in the selected file.");
        return;
      }

      await this.store.overwrite([...existing, ...imported]);
      window.showInformationMessage(`Imported ${imported.length} actions.`);
    } catch (error) {
      window.showErrorMessage(`Failed to import actions: ${(error as Error).message}`);
    }
  }

  async exportActions(): Promise<void> {
    const target = await window.showSaveDialog({
      title: "Export Snip It actions",
      filters: { "Snip It": ["json"] },
      defaultUri: Uri.file(path.join(osTmpDir(), "snip-it-actions.json")),
    });

    if (!target) {
      return;
    }

    const serialized = JSON.stringify(this.activeActions, null, 2);
    await workspace.fs.writeFile(target, Buffer.from(serialized, "utf8"));
    window.showInformationMessage(`Exported ${this.activeActions.length} actions.`);
  }

  private handleStoreUpdate(actions: readonly ActionDefinition[]): void {
    this.applyActions(actions);
  }

  private applyActions(actions: readonly ActionDefinition[]): void {
    const deduped = Array.from(new Map(actions.map(action => [action.id, action])).values());
    this.activeActions = deduped;
    this.tree.setActions(deduped);
    void setContextKey(CONTEXT_HAS_ACTIONS, deduped.length > 0);
  }

  private async transformEnvVariables(
    actionId: string,
    envDraft: readonly ActionEditorEnvVariable[],
  ): Promise<readonly ActionEnvironmentVariable[]> {
    const env: ActionEnvironmentVariable[] = [];

    if (!envDraft) {
      return env;
    }

    for (const entry of envDraft) {
      const key = entry.key.trim();
      if (!key) {
        continue;
      }

      if (entry.fromSecret) {
        const secretKey = entry.secretKey ?? SecretManager.createSecretKey(actionId, key);

        if (entry.secretValue === null) {
          await this.secretManager.deleteSecret(secretKey);
          continue;
        }

        if (entry.secretValue !== undefined) {
          await this.secretManager.storeSecret(secretKey, entry.secretValue);
        }

        env.push({ key, fromSecret: true, secretKey });
      } else {
        const value = entry.value?.trim();
        env.push({ key, value });
      }
    }

    return env;
  }

  private async buildExecutionContext(overrides: Partial<ActionExecutionContext> = {}): Promise<ActionExecutionContext> {
    const activeEditor = window.activeTextEditor;

    const selectedText = getSelectedText(activeEditor);
    const activeUri = activeEditor?.document.uri;
    const explorerSelection = overrides?.explorerSelection;
    const focusUri = explorerSelection ?? activeUri;
    const workspaceFolder = focusUri
      ? workspace.getWorkspaceFolder(focusUri)?.uri
      : workspace.workspaceFolders?.[0]?.uri;
    const relativeFile = focusUri && workspaceFolder ? path.relative(workspaceFolder.fsPath, focusUri.fsPath) : undefined;
    const lineNumber = activeEditor ? activeEditor.selection.active.line + 1 : undefined;
    const clipboardText = await env.clipboard.readText();

    return {
      workspaceFolder,
      activeFile: activeUri,
      relativeFile,
      selectedText,
      clipboardText,
      lineNumber,
      ...overrides,
      explorerSelection,
    };
  }

  private async runChainedActions(
    action: ActionDefinition,
    result: ActionExecutionResult,
    baseContext: ActionExecutionContext,
  ): Promise<void> {
    if (!action.chain || action.chain.length === 0) {
      return;
    }

    const visited = new Set<string>([action.id]);
    let previousResult = result;

    for (const link of action.chain) {
      if (visited.has(link.targetActionId)) {
        window.showWarningMessage("Detected cyclical action chain. Stopping execution.");
        break;
      }

      const nextAction = this.activeActions.find(candidate => candidate.id === link.targetActionId);
      if (!nextAction) {
        window.showWarningMessage(`Chained action ${link.targetActionId} not found.`);
        break;
      }

      visited.add(nextAction.id);

      const overrides: Record<string, string> = {};
      if (link.passOutputAs) {
        overrides[link.passOutputAs] = this.prepareChainedOutput(previousResult.stdout);
      }

      try {
        previousResult = await this.executor.execute(nextAction, baseContext, overrides, nextAction.runInOutputChannel);
        if (previousResult.exitCode !== 0) {
          break;
        }
      } catch (error) {
        window.showErrorMessage(`Failed to run chained action "${nextAction.name}": ${(error as Error).message}`);
        break;
      }
    }
  }

  private normalizeWorkingDirectory(input?: string): string | undefined {
    const trimmed = input?.trim();
    if (!trimmed) {
      return undefined;
    }

    if (path.isAbsolute(trimmed)) {
      return trimmed;
    }

    return trimmed.replace(/[/\\]+/g, path.sep);
  }

  private async testDraft(
    draft: ActionEditorDraft,
    baseAction: ActionDefinition | undefined,
  ): Promise<ActionExecutionResult> {
    const { action, cleanup } = await this.buildTestActionDefinition(draft, baseAction);
    const context = await this.buildExecutionContext();

    try {
      return await this.executor.execute(action, context, {}, true);
    } finally {
      await cleanup();
    }
  }

  private prepareChainedOutput(output: string): string {
    return output.replace(/[\r\n]+$/u, "");
  }

  private async buildTestActionDefinition(
    draft: ActionEditorDraft,
    baseAction: ActionDefinition | undefined,
  ): Promise<{ action: ActionDefinition; cleanup: () => Promise<void> }> {
    const cleanupKeys: string[] = [];
    const baseId = baseAction?.id ?? `test-${randomUUID()}`;
    const now = new Date().toISOString();

    const env: ActionEnvironmentVariable[] = [];

    for (const entry of draft.env ?? []) {
      const key = entry.key.trim();
      if (!key) {
        continue;
      }

      if (entry.fromSecret) {
        if (entry.secretValue === null) {
          throw new Error(`Secret ${key} is marked for removal. Provide a value before testing.`);
        }

        let secretValue = entry.secretValue ?? undefined;
        if (secretValue === undefined && entry.secretKey) {
          secretValue = await this.secretManager.readSecret(entry.secretKey);
        }

        if (secretValue === undefined) {
          throw new Error(`Secret value for ${key} is required to test this action.`);
        }

        let secretKey = entry.secretKey;
        if (!secretKey || entry.secretValue !== undefined) {
          secretKey = SecretManager.createSecretKey(baseId, `${key}-test`);
          await this.secretManager.storeSecret(secretKey, secretValue);
          cleanupKeys.push(secretKey);
        }

        env.push({ key, fromSecret: true, secretKey });
      } else {
        env.push({ key, value: entry.value?.trim() });
      }
    }

    const parameters: ActionParameter[] = draft.parameters
      .filter(parameter => parameter.name.trim().length > 0)
      .map(parameter => ({
        ...parameter,
        name: parameter.name.trim(),
      }));

    const action: ActionDefinition = {
      id: baseId,
      createdAt: baseAction?.createdAt ?? now,
      updatedAt: now,
      name: draft.name.trim() || baseAction?.name || "Untitled Action",
      description: draft.description?.trim(),
      tags: draft.tags.map(tag => tag.trim()).filter(Boolean),
      language: draft.language,
      script: draft.script,
      env,
      parameters,
      workingDirectory: this.normalizeWorkingDirectory(draft.workingDirectory) ?? baseAction?.workingDirectory,
      runInOutputChannel: draft.runInOutputChannel ?? false,
      chain: [],
    };

    return {
      action,
      cleanup: async () => {
        await Promise.all(cleanupKeys.map(key => this.secretManager.deleteSecret(key)));
      },
    };
  }
}

function getSelectedText(editor: TextEditor | undefined): string | undefined {
  if (!editor) {
    return undefined;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    return undefined;
  }

  return editor.document.getText(selection);
}

function osTmpDir(): string {
  const tmp = process.env.TEMP || process.env.TMPDIR || process.env.TMP || "/tmp";
  return tmp;
}
