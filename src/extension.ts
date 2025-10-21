// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { ExtensionManager } from "./extension/extensionManager";

let manager: ExtensionManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  manager = new ExtensionManager(context);
  await manager.initialize();
  context.subscriptions.push(manager);
}

export async function deactivate(): Promise<void> {
  manager?.dispose();
  manager = undefined;
}
