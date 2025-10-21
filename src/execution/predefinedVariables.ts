import { Uri, workspace } from "vscode";
import { ActionExecutionContext } from "../actions/actionTypes";

export interface PredefinedVariable {
  readonly name: string;
  readonly description: string;
  readonly resolve: (context: ActionExecutionContext) => string | undefined;
}

function uriToFsPath(uri?: Uri): string | undefined {
  return uri?.fsPath;
}

export const PREDEFINED_VARIABLES: readonly PredefinedVariable[] = [
  {
    name: "workspaceFolder",
    description: "The path of the open root folder.",
    resolve: context => uriToFsPath(context.workspaceFolder) ?? workspace.workspaceFolders?.[0]?.uri.fsPath,
  },
  {
    name: "file",
    description: "The full path to the currently active file.",
    resolve: context => uriToFsPath(context.activeFile),
  },
  {
    name: "relativeFile",
    description: "Active file path relative to the workspace root.",
    resolve: context => context.relativeFile,
  },
  {
    name: "selectedText",
    description: "The currently selected text in the active editor.",
    resolve: context => context.selectedText,
  },
  {
    name: "clipboardText",
    description: "The current system clipboard text.",
    resolve: context => context.clipboardText,
  },
  {
    name: "lineNumber",
    description: "Current cursor line number.",
    resolve: context => (context.lineNumber ? String(context.lineNumber) : undefined),
  },
  {
    name: "explorerSelectedPath",
    description: "Path of the file or folder selected in the explorer.",
    resolve: context => uriToFsPath(context.explorerSelection),
  },
];

export function resolvePredefinedVariable(name: string, context: ActionExecutionContext): string | undefined {
  const variable = PREDEFINED_VARIABLES.find(candidate => candidate.name === name);
  return variable?.resolve(context);
}
