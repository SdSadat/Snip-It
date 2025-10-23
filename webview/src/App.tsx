import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VSCodeButton, VSCodeCheckbox, VSCodeDropdown, VSCodeOption, VSCodeTextArea, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import Editor, { type Monaco } from "@monaco-editor/react";
import {
  ActionEditorChainLink,
  ActionEditorDraft,
  ActionEditorEnvVariable,
  ActionEditorParameter,
  ActionEditorAvailableAction,
  ExtensionMessage,
  LoadedActionDraft,
  PredefinedVariable,
  ScriptLanguage,
  WebviewMessage,
} from "./types";
import { createMonacoCompletionProvider } from "./monacoCompletion";

const vscode = acquireVsCodeApi();

interface State {
  readonly action?: LoadedActionDraft;
  readonly predefinedVariables: readonly PredefinedVariable[];
  readonly availableActions: readonly ActionEditorAvailableAction[];
}

const defaultState: State = {
  predefinedVariables: [],
  availableActions: [],
};

const modeLabel: Record<ScriptLanguage, string> = {
  bash: "Bash",
  powershell: "PowerShell",
  node: "JavaScript (Node.js)",
  python: "Python",
};

type TestStatus =
  | { readonly state: "idle" }
  | { readonly state: "running" }
  | {
      readonly state: "success";
      readonly exitCode: number | null | undefined;
      readonly stdout: string;
      readonly stderr: string;
    }
  | {
      readonly state: "error";
      readonly message: string;
    };

export const App: React.FC = () => {
  const [state, setState] = useState<State>(defaultState);
  const [draft, setDraft] = useState<ActionEditorDraft>(defaultDraft());
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: "idle" });
  const validationMessages = useMemo(() => validateDraft(draft, state.availableActions), [draft, state.availableActions]);
  const hasBlockingErrors = validationMessages.length > 0;

  const predefinedVariables = state.predefinedVariables;
  const availableActions = state.availableActions;
  const latestDraftRef = useRef<ActionEditorDraft>(draft);
  const latestPredefinedRef = useRef<readonly PredefinedVariable[]>(predefinedVariables);

  useEffect(() => {
    latestDraftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    latestPredefinedRef.current = predefinedVariables;
  }, [predefinedVariables]);

  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;

      if (message.type === "init") {
        const payload = message.payload;
        setState({
          predefinedVariables: payload.predefinedVariables,
          availableActions: payload.availableActions,
          action: payload.action,
        });
        setDraft(normalizeDraft(payload.action ?? defaultDraft()));
        setTestStatus({ state: "idle" });
      }

      if (message.type === "focus") {
        document.getElementById("name-field")?.focus();
      }

      if (message.type === "testResult") {
        const payload = message.payload;
        if (payload.success) {
          setTestStatus({
            state: "success",
            exitCode: payload.exitCode,
            stdout: payload.stdout ?? "",
            stderr: payload.stderr ?? "",
          });
        } else {
          setTestStatus({
            state: "error",
            message: payload.message ?? "Test failed. Check the output channel for details.",
          });
        }
      }

      if (message.type === "rootDirectorySelected") {
        setDraft(prev => ({ ...prev, workingDirectory: message.payload.value ?? "" }));
      }
    };

    window.addEventListener("message", listener);
    vscode.postMessage({ type: "ready" } satisfies WebviewMessage);
    return () => window.removeEventListener("message", listener);
  }, []);

  useEffect(() => {
    if (state.action) {
      setDraft(normalizeDraft(state.action));
    } else {
      setDraft(defaultDraft());
    }
  }, [state.action]);

  const monacoOptions = useMemo(
    () => ({
      minimap: { enabled: false },
      wordWrap: "on" as const,
      scrollBeyondLastLine: false,
    }),
    [],
  );

  const resetTestStatus = useCallback(() => {
    setTestStatus(prev => (prev.state === "idle" ? prev : { state: "idle" }));
  }, []);

  const handleMonacoMount = (_editor: unknown, monaco: Monaco) => {
    createMonacoCompletionProvider(monaco, () => ({
      predefined: latestPredefinedRef.current,
      parameters: latestDraftRef.current?.parameters ?? [],
    }));
  };

  const updateDraft = useCallback(<Key extends keyof ActionEditorDraft>(key: Key, value: ActionEditorDraft[Key]) => {
    let didChange = false;
    setDraft(prev => {
      if (prev[key] === value) {
        return prev;
      }

      didChange = true;
      return { ...prev, [key]: value };
    });

    if (didChange) {
      resetTestStatus();
    }
  }, [resetTestStatus]);

  const handleTest = () => {
    setTestStatus({ state: "running" });
    const message: WebviewMessage = { type: "test", payload: sanitizeDraftBeforeSave(draft) };
    vscode.postMessage(message);
  };

  const handleRootDirectoryBrowse = () => {
    vscode.postMessage({ type: "selectRootDirectory" } satisfies WebviewMessage);
  };

  const handleSubmit = () => {
    const message: WebviewMessage = { type: "save", payload: sanitizeDraftBeforeSave(draft) };
    vscode.postMessage(message);
  };

  const handleCancel = () => vscode.postMessage({ type: "cancel" } satisfies WebviewMessage);

  return (
    <div className="container">
      <header className="header">
        <h1>Snip It Action</h1>
        <div className="header-actions">
          <VSCodeButton appearance="secondary" onClick={handleCancel}>Cancel</VSCodeButton>
          <VSCodeButton
            appearance="secondary"
            onClick={handleTest}
            disabled={testStatus.state === "running" || hasBlockingErrors}
            title={hasBlockingErrors ? "Resolve validation issues before testing." : undefined}
          >
            {testStatus.state === "running" ? "Testing..." : "Test Action"}
          </VSCodeButton>
          <VSCodeButton
            appearance="primary"
            onClick={handleSubmit}
            disabled={hasBlockingErrors}
            title={hasBlockingErrors ? "Resolve validation issues before saving." : undefined}
          >
            Save Action
          </VSCodeButton>
        </div>
      </header>

      {validationMessages.length > 0 && (
        <div className="validation-summary" role="alert">
          <strong>Resolve these issues before running the action:</strong>
          <ul>
            {validationMessages.map(message => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}

      {testStatus.state !== "idle" && (
        <div className={`test-status ${testStatus.state}`}>
          {testStatus.state === "running" && <span>Running action test...</span>}
          {testStatus.state === "success" && (
            <div className="test-status__content">
              <strong>Test completed (exit code {testStatus.exitCode ?? 0}).</strong>
              {testStatus.stdout && (
                <details>
                  <summary>Standard Output</summary>
                  <pre>{testStatus.stdout}</pre>
                </details>
              )}
              {testStatus.stderr && (
                <details open>
                  <summary>Standard Error</summary>
                  <pre className="stderr-output">{testStatus.stderr}</pre>
                </details>
              )}
            </div>
          )}
          {testStatus.state === "error" && (
            <div className="test-status__content">
              <strong>Test failed.</strong>
              <p>{testStatus.message}</p>
            </div>
          )}
        </div>
      )}

      <section className="section">
        <h2>Details</h2>
        <div className="grid">
          <div className="field">
            <label htmlFor="name-field">Action Name</label>
            <VSCodeTextField
              id="name-field"
              value={draft.name}
              placeholder="Create Component from Template"
              onInput={event => updateDraft("name", (event.target as HTMLInputElement).value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="description-field">Description</label>
            <VSCodeTextArea
              id="description-field"
              value={draft.description ?? ""}
              onInput={event => updateDraft("description", (event.target as HTMLTextAreaElement).value)}
              placeholder="Describe what this action does"
              resize="vertical"
              rows={3}
            />
          </div>
          <div className="field">
            <label htmlFor="tags-field">Tags</label>
            <VSCodeTextField
              id="tags-field"
              value={draft.tags.join(", ")}
              placeholder="git, text utils"
              onInput={event => updateDraft("tags", parseTags((event.target as HTMLInputElement).value))}
            />
          </div>
          <div className="field">
            <label htmlFor="root-directory-field">Root Directory</label>
            <div className="root-directory-input">
              <VSCodeTextField
                id="root-directory-field"
                value={draft.workingDirectory ?? ""}
                placeholder="Defaults to workspace folder"
                onInput={event => updateDraft("workingDirectory", (event.target as HTMLInputElement).value)}
              />
              <VSCodeButton appearance="secondary" type="button" onClick={handleRootDirectoryBrowse}>
                Browse…
              </VSCodeButton>
            </div>
            <p className="hint">Optional folder used as the action&apos;s working directory.</p>
          </div>
          <div className="field">
            <label htmlFor="language-field">Script Language</label>
            <VSCodeDropdown
              id="language-field"
              value={draft.language}
              onChange={event => updateDraft("language", (event.target as HTMLSelectElement).value as ScriptLanguage)}
            >
              {Object.entries(modeLabel).map(([value, label]) => (
                <VSCodeOption key={value} value={value}>
                  {label}
                </VSCodeOption>
              ))}
            </VSCodeDropdown>
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Script</h2>
        <Editor
          height="280px"
          defaultLanguage={languageToMonacoLanguage(draft.language)}
          language={languageToMonacoLanguage(draft.language)}
          path={getScriptModelPath(draft.language)}
          value={draft.script}
          onChange={value => updateDraft("script", value ?? "")}
          options={monacoOptions}
          onMount={handleMonacoMount}
        />
        <p className="hint">Use ${`{varName}`} to use declared variables.</p>
      </section>

      <EnvironmentEditor values={draft.env} onChange={value => updateDraft("env", value)} />
      <ParameterEditor values={draft.parameters} onChange={value => updateDraft("parameters", value)} />
      <ChainingEditor
        values={draft.chain ?? []}
        onChange={value => updateDraft("chain", value)}
        availableActions={availableActions.filter(action => action.id !== state.action?.id)}
      />

      <section className="section">
        <VSCodeCheckbox
          checked={draft.runInOutputChannel ?? false}
          onChange={event => updateDraft("runInOutputChannel", (event.target as HTMLInputElement).checked)}
        >
          Send output to Snip It output channel instead of a terminal.
        </VSCodeCheckbox>
      </section>

      <footer className="footer">
        <VSCodeButton appearance="secondary" onClick={handleCancel}>Cancel</VSCodeButton>
        <VSCodeButton appearance="primary" onClick={handleSubmit}>Save Action</VSCodeButton>
      </footer>
    </div>
  );
};

function defaultDraft(): ActionEditorDraft {
  return {
    name: "",
    description: "",
    tags: [],
    language: "bash",
    script: "",
    env: [],
    parameters: [],
    runInOutputChannel: false,
    chain: [],
    workingDirectory: "",
  };
}

function normalizeDraft(draft: ActionEditorDraft): ActionEditorDraft {
  return {
    ...draft,
    workingDirectory: draft.workingDirectory ?? "",
  };
}

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map(tag => tag.trim())
    .filter(Boolean);
}

interface EnvironmentEditorProps {
  readonly values: readonly ActionEditorEnvVariable[];
  readonly onChange: (values: ActionEditorEnvVariable[]) => void;
}

const EnvironmentEditor: React.FC<EnvironmentEditorProps> = ({ values, onChange }) => {
  const addEnvVariable = () => onChange([...values, { key: "", value: "" }]);
  const update = (index: number, patch: Partial<ActionEditorEnvVariable>) => {
    const next = values.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
    onChange(next);
  };

  const remove = (index: number) => onChange(values.filter((_, idx) => idx !== index));

  return (
    <section className="section">
      <header className="section-header">
        <h2>Environment Variables</h2>
        <VSCodeButton appearance="icon" onClick={addEnvVariable} aria-label="Add environment variable">
          +
        </VSCodeButton>
      </header>
      {values.length === 0 ? (
        <p className="hint">No environment variables defined.</p>
      ) : (
        <div className="list">
          {values.map((variable, index) => (
            <div className="list-item" key={index}>
              <VSCodeTextField
                value={variable.key}
                onInput={event => update(index, { key: (event.target as HTMLInputElement).value })}
                placeholder="API_TOKEN"
                aria-label="Key"
              />
              {variable.fromSecret ? (
                <VSCodeTextField
                  value={variable.secretValue ?? ""}
                  onInput={event => update(index, { secretValue: (event.target as HTMLInputElement).value })}
                  placeholder="Secret value"
                  aria-label="Secret"
                />
              ) : (
                <VSCodeTextField
                  value={variable.value ?? ""}
                  onInput={event => update(index, { value: (event.target as HTMLInputElement).value })}
                  placeholder="Value"
                  aria-label="Value"
                />
              )}
              <VSCodeCheckbox
                checked={variable.fromSecret ?? false}
                onChange={event => {
                  const checked = (event.target as HTMLInputElement).checked;
                  update(index, checked ? { fromSecret: true, value: undefined } : { fromSecret: false, secretValue: null });
                }}
              >
                Secret
              </VSCodeCheckbox>
              <VSCodeButton appearance="icon" onClick={() => remove(index)} aria-label="Remove variable">
                ✕
              </VSCodeButton>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

interface ParameterEditorProps {
  readonly values: readonly ActionEditorParameter[];
  readonly onChange: (values: ActionEditorParameter[]) => void;
}

const ParameterEditor: React.FC<ParameterEditorProps> = ({ values, onChange }) => {
  const addParameter = () => onChange([...values, { name: "", prompt: "" }]);
  const update = (index: number, patch: Partial<ActionEditorParameter>) => {
    const next = values.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
    onChange(next);
  };

  const remove = (index: number) => onChange(values.filter((_, idx) => idx !== index));

  return (
    <section className="section">
      <header className="section-header">
        <h2>Parameters</h2>
        <VSCodeButton appearance="icon" onClick={addParameter} aria-label="Add parameter">
          +
        </VSCodeButton>
      </header>
      {values.length === 0 ? (
        <p className="hint">No custom parameters defined.</p>
      ) : (
        <div className="list">
          {values.map((parameter, index) => (
            <div className="list-item" key={index}>
              <VSCodeTextField
                value={parameter.name}
                onInput={event => update(index, { name: (event.target as HTMLInputElement).value })}
                placeholder="ParamName"
                aria-label="Name"
              />
              <VSCodeTextField
                value={parameter.defaultValue ?? ""}
                onInput={event => update(index, { defaultValue: (event.target as HTMLInputElement).value })}
                placeholder="Default value"
              />
              <VSCodeTextField
                value={parameter.prompt ?? ""}
                onInput={event => update(index, { prompt: (event.target as HTMLInputElement).value })}
                placeholder="Prompt shown to the user"
              />
              <VSCodeCheckbox
                checked={parameter.required ?? false}
                onChange={event => update(index, { required: (event.target as HTMLInputElement).checked })}
              >
                Required
              </VSCodeCheckbox>
              <VSCodeButton appearance="icon" onClick={() => remove(index)} aria-label="Remove parameter">
                ✕
              </VSCodeButton>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

interface ChainingEditorProps {
  readonly values: readonly ActionEditorChainLink[];
  readonly availableActions: readonly ActionEditorAvailableAction[];
  readonly onChange: (values: ActionEditorChainLink[]) => void;
}

const ChainingEditor: React.FC<ChainingEditorProps> = ({ values, onChange, availableActions }) => {
  const addChain = () => onChange([...values, { targetActionId: "", passOutputAs: "" }]);
  const update = (index: number, patch: Partial<ActionEditorChainLink>) => {
    const next = values.map((item, idx) => (idx === index ? { ...item, ...patch } : item));
    onChange(next);
  };

  const remove = (index: number) => onChange(values.filter((_, idx) => idx !== index));

  return (
    <section className="section">
      <header className="section-header">
        <h2>Action Chaining</h2>
        <VSCodeButton appearance="icon" onClick={addChain} aria-label="Add chained action">
          +
        </VSCodeButton>
      </header>
      {values.length === 0 ? (
        <p className="hint">No chained actions configured.</p>
      ) : (
        <div className="list">
          {values.map((link, index) => (
            <div className="list-item" key={index}>
              <label className="field">
                <span>Action</span>
                <VSCodeDropdown
                  value={link.targetActionId}
                  onChange={event => update(index, { targetActionId: (event.target as HTMLSelectElement).value })}
                >
                  <VSCodeOption value="">Select action</VSCodeOption>
                  {availableActions.map(action => (
                    <VSCodeOption key={action.id} value={action.id}>
                      {action.name}
                    </VSCodeOption>
                  ))}
                </VSCodeDropdown>
              </label>
                <VSCodeTextField
                value={link.passOutputAs ?? ""}
                onInput={event => update(index, { passOutputAs: (event.target as HTMLInputElement).value })}
                placeholder="Parameter name to receive output"
              />
              <VSCodeButton appearance="icon" onClick={() => remove(index)} aria-label="Remove chain">
                ✕
              </VSCodeButton>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

function languageToMonacoLanguage(language: ScriptLanguage): string {
  switch (language) {
    case "bash":
      return "shell";
    case "powershell":
      return "powershell";
    case "python":
      return "python";
    case "node":
      return "javascript";
    default:
      return "plaintext";
  }
}

function getScriptModelPath(language: ScriptLanguage): string {
  switch (language) {
    case "bash":
      return "inmemory://model/action.sh";
    case "powershell":
      return "inmemory://model/action.ps1";
    case "python":
      return "inmemory://model/action.py";
    case "node":
      return "inmemory://model/action.mjs";
    default:
      return "inmemory://model/action.txt";
  }
}

function sanitizeDraftBeforeSave(draft: ActionEditorDraft): ActionEditorDraft {
  return {
    ...draft,
    tags: draft.tags.map(tag => tag.trim()).filter(Boolean),
    script: draft.script.replace(/\$\{([\w-]+)(?::[^}]+)?}/g, "${$1}"),
    env: draft.env.map(variable => {
      const key = variable.key.trim();

      if (variable.fromSecret) {
        const trimmedSecretKey = variable.secretKey?.trim();
        const trimmedSecretValue = variable.secretValue?.trim();
        return {
          ...variable,
          key,
          value: undefined,
          secretKey: trimmedSecretKey || undefined,
          secretValue: variable.secretValue === null
            ? null
            : trimmedSecretValue || undefined,
        };
      }

      return {
        ...variable,
        key,
        value: variable.value?.trim() ?? "",
        secretKey: undefined,
        secretValue: undefined,
      };
    }),
    parameters: draft.parameters.map(parameter => ({
      ...parameter,
      name: parameter.name.trim(),
      prompt: parameter.prompt?.trim(),
      defaultValue: parameter.defaultValue?.trim(),
    })),
    chain: draft.chain?.map(link => ({
      targetActionId: link.targetActionId,
      passOutputAs: link.passOutputAs?.trim() || undefined,
    })),
    workingDirectory: draft.workingDirectory?.trim() ? draft.workingDirectory.trim() : undefined,
  };
}

function validateDraft(
  draft: ActionEditorDraft,
  availableActions: readonly ActionEditorAvailableAction[],
): string[] {
  const issues: string[] = [];

  if (!draft.name.trim()) {
    issues.push("Action name is required.");
  }

  if (!draft.script.trim()) {
    issues.push("Script content cannot be empty.");
  }

  const envKeys = new Set<string>();
  draft.env.forEach((variable, index) => {
    const key = variable.key.trim();
    if (!key) {
      issues.push(`Environment variable #${index + 1} needs a key.`);
      return;
    }

    const normalized = key.toLowerCase();
    if (envKeys.has(normalized)) {
      issues.push(`Environment variable "${key}" is defined more than once.`);
    }
    envKeys.add(normalized);
  });

  const parameterNames = new Set<string>();
  draft.parameters.forEach((parameter, index) => {
    const name = parameter.name?.trim() ?? "";
    if (!name) {
      issues.push(`Parameter #${index + 1} needs a name.`);
      return;
    }

    const normalized = name.toLowerCase();
    if (parameterNames.has(normalized)) {
      issues.push(`Parameter "${name}" is defined more than once.`);
    }
    parameterNames.add(normalized);
  });

  draft.chain?.forEach((link, index) => {
    if (!link.targetActionId) {
      issues.push(`Chained action #${index + 1} needs a selected action.`);
    } else if (!availableActions.some(action => action.id === link.targetActionId)) {
      issues.push(`Chained action #${index + 1} references an unavailable action.`);
    }

    const paramName = link.passOutputAs?.trim();
    if (paramName && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(paramName)) {
      issues.push(`Chained action #${index + 1} output alias must be a valid parameter name.`);
    }
  });

  return Array.from(new Set(issues));
}

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
}

function acquireVsCodeApi(): VsCodeApi {
  return (window as unknown as { acquireVsCodeApi(): VsCodeApi }).acquireVsCodeApi();
}
