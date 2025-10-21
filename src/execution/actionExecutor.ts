import { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio, spawn } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { pathToFileURL } from "url";
import { Disposable, EventEmitter, OutputChannel, Pseudoterminal, Terminal, TerminalDimensions, window, workspace } from "vscode";
import { ActionDefinition, ActionExecutionContext, ActionExecutionResult } from "../actions/actionTypes";
import { replaceTemplateTokens } from "./templateEngine";
import { ParameterResolver } from "./parameterResolver";
import { PREDEFINED_VARIABLES, resolvePredefinedVariable } from "./predefinedVariables";
import { SecretManager } from "../secrets/secretManager";

interface ExecutionPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly scriptPath: string;
}

interface ExecuteOptions {
  readonly context: ActionExecutionContext;
  readonly parameterValues: Record<string, string>;
}

class ProcessTerminal implements Pseudoterminal, Disposable {
  private readonly writeEmitter = new EventEmitter<string>();
  private readonly closeEmitter = new EventEmitter<void>();
  private process: ChildProcessWithoutNullStreams | undefined;
  private disposed = false;

  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;

  constructor(
    private readonly plan: ExecutionPlan,
    private readonly spawnOptions: SpawnOptionsWithoutStdio,
    private readonly onResult: (result: ActionExecutionResult) => void,
  ) {}

  open(): void {
    this.launch();
  }

  close(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    if (this.process && !this.process.killed) {
      this.process.kill();
    }

    this.process?.removeAllListeners();
    this.writeEmitter.dispose();
    this.closeEmitter.fire();
    this.closeEmitter.dispose();
  }

  setDimensions(_: TerminalDimensions): void {
    // Terminal resizing is ignored for the pseudo-terminal scenario.
  }

  private launch(): void {
    this.process = spawn(this.plan.command, [...this.plan.args], this.spawnOptions);

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    this.process.stdout.setEncoding("utf8");
    this.process.stderr.setEncoding("utf8");

    this.process.stdout.on("data", chunk => {
      stdoutChunks.push(chunk);
      this.writeEmitter.fire(chunk);
    });

    this.process.stderr.on("data", chunk => {
      stderrChunks.push(chunk);
      this.writeEmitter.fire(chunk);
    });

    this.process.on("close", code => {
      this.onResult({
        actionId: this.spawnOptions.env?.CODE_BUTLER_ACTION_ID ?? "",
        exitCode: code,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      });
      this.dispose();
    });

    this.process.on("error", error => {
      this.writeEmitter.fire(`[Snip It] Failed to launch process: ${(error as Error).message}\r\n`);
      this.onResult({
        actionId: this.spawnOptions.env?.CODE_BUTLER_ACTION_ID ?? "",
        exitCode: -1,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.concat(String(error)).join(""),
      });
      this.dispose();
    });
  }
}

export class ActionExecutor {
  private readonly outputChannel: OutputChannel;

  constructor(
    private readonly secretManager: SecretManager,
    private readonly parameterResolver: ParameterResolver,
    private readonly nodeLoaderPath?: string,
  ) {
    this.outputChannel = window.createOutputChannel("Snip It");
  }

  async execute(
    action: ActionDefinition,
    context: ActionExecutionContext,
    parameterOverrides: Record<string, string> = {},
    forceOutputChannel = false,
  ): Promise<ActionExecutionResult> {
    const parameterValues = await this.parameterResolver.resolve(action, { providedValues: parameterOverrides });
    const executeOptions: ExecuteOptions = { context, parameterValues };
    const plan = await this.prepareExecutionPlan(action, executeOptions);
  const workingDirectory = this.resolveWorkingDirectory(action, context);
  const spawnOptions = await this.createSpawnOptions(action, executeOptions, workingDirectory);
    const useOutputChannel = forceOutputChannel || !!action.runInOutputChannel;

    if (useOutputChannel) {
      return this.runWithOutputChannel(action, plan, spawnOptions);
    }

    return this.runWithTerminal(action, plan, spawnOptions);
  }

  getPredefinedVariables(): readonly { name: string; description: string }[] {
    return PREDEFINED_VARIABLES.map(variable => ({ name: variable.name, description: variable.description }));
  }

  private async runWithTerminal(action: ActionDefinition, plan: ExecutionPlan, spawnOptions: SpawnOptionsWithoutStdio): Promise<ActionExecutionResult> {
    return await new Promise<ActionExecutionResult>(resolve => {
      const terminal = new ProcessTerminal(plan, spawnOptions, result => resolve(result));
      const vscodeTerminal: Terminal = window.createTerminal({
        name: `Snip It: ${action.name}`,
        pty: terminal,
      });

      vscodeTerminal.show(true);
    }).finally(async () => {
      await this.cleanup(plan.scriptPath);
    });
  }

  private async runWithOutputChannel(action: ActionDefinition, plan: ExecutionPlan, spawnOptions: SpawnOptionsWithoutStdio): Promise<ActionExecutionResult> {
    this.outputChannel.appendLine(`▶ ${action.name}`);

    return await new Promise<ActionExecutionResult>((resolve, reject) => {
      const child = spawn(plan.command, [...plan.args], spawnOptions);
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", chunk => {
        stdoutChunks.push(chunk);
        this.outputChannel.append(chunk);
      });

      child.stderr.on("data", chunk => {
        stderrChunks.push(chunk);
        this.outputChannel.append(chunk);
      });

      child.on("close", code => {
        this.outputChannel.appendLine(`↳ exited with code ${code ?? 0}`);
        resolve({
          actionId: action.id,
          exitCode: code,
          stdout: stdoutChunks.join(""),
          stderr: stderrChunks.join(""),
        });
      });

      child.on("error", error => {
        const message = (error as Error).message;
        this.outputChannel.appendLine(`✖ Process launch failed: ${message}`);
        reject(error);
      });
    }).finally(async () => {
      await this.cleanup(plan.scriptPath);
    });
  }

  private async prepareExecutionPlan(action: ActionDefinition, options: ExecuteOptions): Promise<ExecutionPlan> {
    const resolvedScript = this.replaceTokens(action.script, action, options);
    const suffix = this.getFileExtension(action.language);
    const scriptPath = await this.writeTemporaryScript(action.id, resolvedScript, suffix);

    const command = this.getCommand(action.language);
    const args = this.getCommandArgs(action.language, scriptPath);
  const finalArgs = action.language === "node" ? this.applyNodeRegisterArgs(args) : args;

    return {
      command,
      args: finalArgs,
      scriptPath,
    };
  }

  private async createSpawnOptions(
    action: ActionDefinition,
    options: ExecuteOptions,
    workingDirectory: string,
  ): Promise<SpawnOptionsWithoutStdio> {
    const env = await this.buildEnvironment(action, options, workingDirectory);

    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd: workingDirectory,
      env,
    };

    return spawnOptions;
  }

  private async buildEnvironment(
    action: ActionDefinition,
    options: ExecuteOptions,
    workingDirectory: string,
  ): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env, CODE_BUTLER_ACTION_ID: action.id };
    env.CODE_BUTLER_WORKING_DIRECTORY = workingDirectory;

    const substitute = (input?: string) => (input ? this.replaceTokens(input, action, options) : undefined);

    for (const entry of action.env) {
      if (!entry.key) {
        continue;
      }

      if (entry.fromSecret) {
        const secretValue = await this.secretManager.readSecret(entry.secretKey);
        if (secretValue === undefined) {
          throw new Error(`Secret value not found for ${entry.key}. Update the secret and try again.`);
        }

        env[entry.key] = substitute(secretValue) ?? "";
      } else if (entry.value !== undefined) {
        env[entry.key] = substitute(entry.value) ?? "";
      }
    }

    for (const parameterName of Object.keys(options.parameterValues)) {
      env[`PARAM_${parameterName.toUpperCase()}`] = options.parameterValues[parameterName];
    }

    return env;
  }

  private resolveWorkingDirectory(action: ActionDefinition, context: ActionExecutionContext): string {
    const configured = action.workingDirectory?.trim();

    if (configured) {
      if (path.isAbsolute(configured)) {
        return configured;
      }

      const base = context.workspaceFolder?.fsPath ?? workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (base) {
        return path.resolve(base, configured);
      }

      return path.resolve(os.homedir(), configured);
    }

    return context.workspaceFolder?.fsPath ?? workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
  }

  private replaceTokens(source: string, action: ActionDefinition, options: ExecuteOptions): string {
    return replaceTemplateTokens(source, token => {
      if (token.key === "param") {
        const [name] = token.args;
        return name ? options.parameterValues[name] : undefined;
      }

      const predefined = resolvePredefinedVariable(token.key, options.context);
      if (predefined !== undefined) {
        return predefined;
      }

      const matchingParameter = action.parameters.find(parameter => parameter.name === token.key);
      if (matchingParameter) {
        return options.parameterValues[matchingParameter.name];
      }

      return undefined;
    });
  }

  private getFileExtension(language: ActionDefinition["language"]): string {
    switch (language) {
      case "bash":
        return ".sh";
      case "powershell":
        return ".ps1";
      case "python":
        return ".py";
      case "node":
        return ".mjs";
      default:
        return ".txt";
    }
  }

  private getCommand(language: ActionDefinition["language"]): string {
    if (language === "powershell") {
      return process.platform === "win32" ? "powershell" : "pwsh";
    }

    if (language === "node") {
      return "node";
    }

    if (language === "python") {
      return "python";
    }

    return "bash";
  }

  private getCommandArgs(language: ActionDefinition["language"], scriptPath: string): readonly string[] {
    switch (language) {
      case "bash":
        return [scriptPath];
      case "powershell":
        return ["-File", scriptPath];
      case "python":
        return [scriptPath];
      case "node":
        return [scriptPath];
      default:
        return [scriptPath];
    }
  }

  private applyNodeRegisterArgs(args: readonly string[]): readonly string[] {
    const importArg = this.getNodeRegisterImportArg();
    if (!importArg) {
      return args;
    }

    return ["--import", importArg, ...args];
  }

  private getNodeRegisterImportArg(): string | undefined {
    if (!this.nodeLoaderPath) {
      return undefined;
    }

    const loaderUrl = pathToFileURL(this.nodeLoaderPath).href;
    const registrationSnippet = `import { register } from "node:module"; import { pathToFileURL } from "node:url"; register(${JSON.stringify(loaderUrl)}, pathToFileURL("./"));`;
    return `data:text/javascript,${encodeURIComponent(registrationSnippet)}`;
  }

  private async writeTemporaryScript(actionId: string, script: string, extension: string): Promise<string> {
    const fileName = `${actionId}-${Date.now()}${extension}`;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "snip-it-"));
    const scriptPath = path.join(tempDir, fileName);
    const normalized = script.replace(/\r?\n/g, os.EOL);
    await fs.writeFile(scriptPath, normalized, { encoding: "utf8", mode: 0o700 });
    return scriptPath;
  }

  private async cleanup(scriptPath: string): Promise<void> {
    try {
      await fs.unlink(scriptPath);
      const folder = path.dirname(scriptPath);
      await fs.rm(folder, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[Snip It] Failed to remove temp script ${scriptPath}:`, error);
      }
    }
  }
}
