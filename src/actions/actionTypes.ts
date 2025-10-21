import { Uri } from "vscode";

export type ScriptLanguage = "bash" | "powershell" | "node" | "python";

export interface ActionParameter {
  readonly name: string;
  readonly prompt?: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
}

export interface ActionEnvironmentVariable {
  readonly key: string;
  readonly value?: string;
  readonly fromSecret?: boolean;
  readonly secretKey?: string;
}

export interface ActionChainLink {
  readonly targetActionId: string;
  readonly passOutputAs?: string;
}

export interface ActionDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly language: ScriptLanguage;
  readonly script: string;
  readonly env: readonly ActionEnvironmentVariable[];
  readonly parameters: readonly ActionParameter[];
  readonly workingDirectory?: string;
  readonly runInOutputChannel?: boolean;
  readonly chain?: readonly ActionChainLink[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ActionReference {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly tags: readonly string[];
}

export interface ActionExecutionContext {
  readonly workspaceFolder?: Uri;
  readonly activeFile?: Uri;
  readonly relativeFile?: string;
  readonly selectedText?: string;
  readonly clipboardText?: string;
  readonly lineNumber?: number;
  readonly explorerSelection?: Uri;
}

export interface ActionExecutionResult {
  readonly actionId: string;
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}
