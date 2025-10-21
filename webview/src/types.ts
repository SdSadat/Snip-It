export type ScriptLanguage = "bash" | "powershell" | "node" | "python";

export interface PredefinedVariable {
  readonly name: string;
  readonly description: string;
}

export interface ActionEditorAvailableAction {
  readonly id: string;
  readonly name: string;
}

export interface ActionEditorEnvVariable {
  readonly key: string;
  readonly value?: string;
  readonly fromSecret?: boolean;
  readonly secretKey?: string;
  readonly secretValue?: string | null;
}

export interface ActionEditorParameter {
  readonly name: string;
  readonly prompt?: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
}

export interface ActionEditorChainLink {
  readonly targetActionId: string;
  readonly passOutputAs?: string;
}

export interface ActionEditorDraft {
  readonly name: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly language: ScriptLanguage;
  readonly script: string;
  readonly env: readonly ActionEditorEnvVariable[];
  readonly parameters: readonly ActionEditorParameter[];
  readonly runInOutputChannel?: boolean;
  readonly chain?: readonly ActionEditorChainLink[];
  readonly workingDirectory?: string;
}

export interface LoadedActionDraft extends ActionEditorDraft {
  readonly id: string;
}

export interface TestResultPayload {
  readonly success: boolean;
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly message?: string;
}

export type ExtensionMessage =
  | {
      readonly type: "init";
      readonly payload: {
        readonly action?: LoadedActionDraft;
        readonly predefinedVariables: readonly PredefinedVariable[];
        readonly availableActions: readonly ActionEditorAvailableAction[];
      };
    }
  | {
      readonly type: "focus";
    }
  | {
      readonly type: "testResult";
      readonly payload: TestResultPayload;
    }
  | {
      readonly type: "rootDirectorySelected";
      readonly payload: {
        readonly value: string;
      };
    };

export type WebviewMessage =
  | {
      readonly type: "ready";
    }
  | {
      readonly type: "save";
      readonly payload: ActionEditorDraft;
    }
  | {
      readonly type: "cancel";
    }
  | {
      readonly type: "test";
      readonly payload: ActionEditorDraft;
    }
  | {
      readonly type: "selectRootDirectory";
    };
