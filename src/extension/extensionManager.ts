import { Disposable, ExtensionContext, Uri, commands, window } from "vscode";
import { ActionService } from "../actions/actionService";
import { ActionStore } from "../actions/actionStore";
import { ActionTreeDataProvider, ActionTreeNode } from "../actions/actionTreeDataProvider";
import { ActionExecutor } from "../execution/actionExecutor";
import { ParameterResolver } from "../execution/parameterResolver";
import { SecretManager } from "../secrets/secretManager";
import { ClipboardTrigger } from "../triggers/clipboardTrigger";
import { ActionEditorProvider } from "../webview/actionEditorProvider";

export class ExtensionManager implements Disposable {
  private readonly disposables: Disposable[] = [];
  private readonly store: ActionStore;
  private readonly tree: ActionTreeDataProvider;
  private readonly secretManager: SecretManager;
  private readonly parameterResolver: ParameterResolver;
  private readonly executor: ActionExecutor;
  private readonly actionService: ActionService;
  private readonly editorProvider: ActionEditorProvider;
  private readonly clipboardTrigger: ClipboardTrigger;

  constructor(private readonly context: ExtensionContext) {
    this.store = new ActionStore(context);
    this.tree = new ActionTreeDataProvider();
    this.secretManager = new SecretManager(context.secrets);
    this.parameterResolver = new ParameterResolver();
  const nodeLoaderPath = context.asAbsolutePath("resources/node-loader.mjs");
  this.executor = new ActionExecutor(this.secretManager, this.parameterResolver, nodeLoaderPath);
    this.editorProvider = new ActionEditorProvider(context, this.executor, () => this.store.getAll());
    this.actionService = new ActionService(context, this.store, this.tree, this.secretManager, this.executor, this.editorProvider);
    this.clipboardTrigger = new ClipboardTrigger(async clipboardText => {
      if (!this.actionService.hasActions()) {
        return;
      }

      const selection = await window.showInformationMessage("Copied! Run a Snippet Action?", "Choose Action");
      if (selection === "Choose Action") {
        await this.actionService.showActionPicker({ clipboardText });
      }
    });
  }

  async initialize(): Promise<void> {
    this.registerTreeView();
    this.registerCommands();
    await this.actionService.initialize();
    this.clipboardTrigger.start();
    this.disposables.push(this.clipboardTrigger);
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.actionService.dispose();
  }

  private registerTreeView(): void {
    const tree = window.createTreeView("snippet.actions", {
      treeDataProvider: this.tree,
    });

    this.disposables.push(tree);
  }

  private registerCommands(): void {
    this.disposables.push(
      commands.registerCommand("snippet.newAction", () => this.actionService.createAction()),
      commands.registerCommand("snippet.editAction", (node?: ActionTreeNode) => this.handleEditCommand(node)),
      commands.registerCommand("snippet.runAction", (nodeOrId?: ActionTreeNode | string) =>
        this.handleRunCommand(nodeOrId),
      ),
      commands.registerCommand("snippet.deleteAction", (node?: ActionTreeNode) => this.handleDeleteCommand(node)),
      commands.registerCommand("snippet.showActionPicker", (resource?: unknown) =>
        this.actionService.showActionPicker(this.extractContextOverrides(resource)),
      ),
      commands.registerCommand("snippet.importActions", () => this.actionService.importActions()),
      commands.registerCommand("snippet.exportActions", () => this.actionService.exportActions()),
      commands.registerCommand("snippet.refreshActions", () => this.actionService.refresh()),
    );
  }

  private handleRunCommand(
    nodeOrId?: ActionTreeNode | string,
    overrides?: ReturnType<typeof this.extractContextOverrides>,
  ): void {
    if (!nodeOrId) {
      void this.actionService.showActionPicker(overrides);
      return;
    }

    if (typeof nodeOrId === "string") {
      void this.actionService.runAction(nodeOrId, overrides);
      return;
    }

    const node = nodeOrId;
    if (node.type === "action") {
      void this.actionService.runAction(node.action.id, overrides);
    }
  }

  private handleEditCommand(node?: ActionTreeNode): void {
    if (node?.type === "action") {
      void this.actionService.editAction(node.action.id);
    }
  }

  private handleDeleteCommand(node?: ActionTreeNode): void {
    if (node?.type === "action") {
      void this.actionService.deleteAction(node.action.id);
    }
  }

  private extractContextOverrides(resource: unknown) {
    if (resource instanceof Uri) {
      return { explorerSelection: resource };
    }

    if (resource && typeof resource === "object") {
      const maybeUri = (resource as { resourceUri?: unknown }).resourceUri;
      if (maybeUri instanceof Uri) {
        return { explorerSelection: maybeUri };
      }
    }

    return undefined;
  }
}
