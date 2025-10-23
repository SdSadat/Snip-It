import { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio, spawn, spawnSync } from "child_process";
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
  readonly bashImplementation?: BashImplementation;
}

interface ExecuteOptions {
  readonly context: ActionExecutionContext;
  readonly parameterValues: Record<string, string>;
}

type BashImplementation = "posix" | "wsl" | "git-bash" | "other";

interface BashCommandInfo {
  readonly command: string;
  readonly implementation: BashImplementation;
}

interface ResolvedCommand {
  readonly command: string;
  readonly bashImplementation?: BashImplementation;
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
  actionId: this.spawnOptions.env?.SNIP_IT_ACTION_ID ?? "",
        exitCode: code,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join(""),
      });
      this.dispose();
    });

    this.process.on("error", error => {
      this.writeEmitter.fire(`[Snip It] Failed to launch process: ${(error as Error).message}\r\n`);
      this.onResult({
  actionId: this.spawnOptions.env?.SNIP_IT_ACTION_ID ?? "",
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
  private cachedBashInfo?: BashCommandInfo;

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
    const workingDirectory = this.resolveWorkingDirectory(action, context);
    const plan = await this.prepareExecutionPlan(action, executeOptions, workingDirectory);
    const spawnOptions = await this.createSpawnOptions(action, executeOptions, workingDirectory, plan);
    const useOutputChannel = forceOutputChannel || !!action.runInOutputChannel;

    this.logExecutionPlan(action, workingDirectory, plan, spawnOptions, useOutputChannel);

    if (useOutputChannel) {
      this.outputChannel.show(true);
    }

    try {
      if (useOutputChannel) {
        return await this.runWithOutputChannel(action, plan, spawnOptions);
      }

      return await this.runWithTerminal(action, plan, spawnOptions);
    } catch (error) {
      this.outputChannel.appendLine(`✖ ${action.name} failed: ${(error as Error).message}`);
      throw error;
    }
  }

  getPredefinedVariables(): readonly { name: string; description: string }[] {
    return PREDEFINED_VARIABLES.map(variable => ({ name: variable.name, description: variable.description }));
  }

  private async runWithTerminal(action: ActionDefinition, plan: ExecutionPlan, spawnOptions: SpawnOptionsWithoutStdio): Promise<ActionExecutionResult> {
    let resolved: ActionExecutionResult | undefined;
    try {
      resolved = await new Promise<ActionExecutionResult>(resolve => {
        const terminal = new ProcessTerminal(plan, spawnOptions, result => resolve(result));
        const vscodeTerminal: Terminal = window.createTerminal({
          name: `Snip It: ${action.name}`,
          pty: terminal,
        });

        vscodeTerminal.show(true);
      });

      this.outputChannel.appendLine(`↳ exited with code ${resolved.exitCode ?? 0}`);
      return resolved;
    } finally {
      await this.cleanup(plan.scriptPath);
    }
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

  private async prepareExecutionPlan(
    action: ActionDefinition,
    options: ExecuteOptions,
    workingDirectory: string,
  ): Promise<ExecutionPlan> {
    const commandInfo = await this.getCommand(action.language, workingDirectory);
    const resolvedScript = this.replaceTokens(action.script, action, options, commandInfo.bashImplementation, "script");
    const suffix = this.getFileExtension(action.language);
    const scriptPath = await this.writeTemporaryScript(action.id, resolvedScript, suffix);

    const args = this.getCommandArgs(action.language, scriptPath, commandInfo.bashImplementation);
    const finalArgs = action.language === "node" ? this.applyNodeRegisterArgs(args) : args;

    return {
      command: commandInfo.command,
      args: finalArgs,
      scriptPath,
      bashImplementation: commandInfo.bashImplementation,
    };
  }

  private async createSpawnOptions(
    action: ActionDefinition,
    options: ExecuteOptions,
    workingDirectory: string,
    plan: ExecutionPlan,
  ): Promise<SpawnOptionsWithoutStdio> {
    const env = await this.buildEnvironment(action, options, workingDirectory, plan.bashImplementation);

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
    bashImplementation?: BashImplementation,
  ): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env, SNIP_IT_ACTION_ID: action.id };
    env.SNIP_IT_WORKING_DIRECTORY = this.normalizePathForShell(workingDirectory, action.language, bashImplementation);

    const substitute = (input?: string) => {
      if (!input) {
        return undefined;
      }

      const replaced = this.replaceTokens(input, action, options, bashImplementation, "environment");
      if (!input.includes("{{")) {
        return this.normalizePathForShell(replaced, action.language, bashImplementation);
      }

      return replaced;
    };

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
      env[`PARAM_${parameterName.toUpperCase()}`] = this.normalizePathForShell(
        options.parameterValues[parameterName],
        action.language,
        bashImplementation,
      );
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

  private replaceTokens(
    source: string,
    action: ActionDefinition,
    options: ExecuteOptions,
    bashImplementation?: BashImplementation,
    target: "script" | "environment" = "script",
  ): string {
    return replaceTemplateTokens(source, token => {
      if (token.key === "param") {
        const [name] = token.args;
        const value = name ? options.parameterValues[name] : undefined;
        return value === undefined
          ? undefined
          : this.formatTokenValue(value, action.language, bashImplementation, target);
      }

      const predefined = resolvePredefinedVariable(token.key, options.context);
      if (predefined !== undefined) {
        return this.formatTokenValue(predefined, action.language, bashImplementation, target);
      }

      const matchingParameter = action.parameters.find(parameter => parameter.name === token.key);
      if (matchingParameter) {
        return this.formatTokenValue(options.parameterValues[matchingParameter.name], action.language, bashImplementation, target);
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

  private async getCommand(language: ActionDefinition["language"], workingDirectory: string): Promise<ResolvedCommand> {
    switch (language) {
      case "powershell":
        return { command: process.platform === "win32" ? "powershell" : "pwsh" };
      case "node":
        return { command: "node" };
      case "python": {
        const venvPython = await this.findPythonInterpreter(workingDirectory);
        return { command: venvPython ?? "python" };
      }
      case "bash":
        if (process.platform === "win32") {
          const info = this.resolveBashCommand();
          return { command: info.command, bashImplementation: info.implementation };
        }
        return { command: "bash", bashImplementation: "posix" };
      default:
        if (process.platform === "win32") {
          const info = this.resolveBashCommand();
          return { command: info.command, bashImplementation: info.implementation };
        }
        return { command: "bash", bashImplementation: "posix" };
    }
  }

  private async findPythonInterpreter(startDirectory: string): Promise<string | undefined> {
    let current = path.resolve(startDirectory);
    const visited = new Set<string>();

    while (!visited.has(current)) {
      visited.add(current);
      const found = await this.findPythonInterpreterInDirectory(current);
      if (found) {
        return found;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    return undefined;
  }

  private async findPythonInterpreterInDirectory(directory: string): Promise<string | undefined> {
    const candidates = [".venv", "venv", "env", ".env", "virtualenv", "pyenv"];

    for (const candidate of candidates) {
      const base = path.join(directory, candidate);
      const executable = process.platform === "win32"
        ? path.join(base, "Scripts", "python.exe")
        : path.join(base, "bin", "python");

      try {
        await fs.access(executable);
        return executable;
      } catch {
        // ignore missing candidate
      }
    }

    const pyenvCfg = path.join(directory, "pyvenv.cfg");
    try {
      await fs.access(pyenvCfg);
      const executable = process.platform === "win32"
        ? path.join(directory, "Scripts", "python.exe")
        : path.join(directory, "bin", "python");
      await fs.access(executable);
      return executable;
    } catch {
      // not a venv root
    }

    return undefined;
  }

  private getCommandArgs(
    language: ActionDefinition["language"],
    scriptPath: string,
    bashImplementation?: BashImplementation,
  ): readonly string[] {
    switch (language) {
      case "bash":
        return [this.convertScriptPathForBash(scriptPath, bashImplementation)];
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

  private logExecutionPlan(
    action: ActionDefinition,
    workingDirectory: string,
    plan: ExecutionPlan,
    spawnOptions: SpawnOptionsWithoutStdio,
    useOutputChannel: boolean,
  ): void {
    const timestamp = new Date().toISOString();
    const args = this.formatArgsForLog(plan.args);
    const interestingEnv = this.collectInterestingEnvKeys(action, spawnOptions.env);
    const cwd = spawnOptions.cwd ?? workingDirectory;

    if (!useOutputChannel) {
      this.outputChannel.appendLine(`▶ ${action.name}`);
    }

    this.outputChannel.appendLine(
      `  - ${timestamp} | language=${action.language} cwd=${cwd}`,
    );
    this.outputChannel.appendLine(`    command: ${plan.command}${args ? ` ${args}` : ""}`);

    if (interestingEnv) {
      this.outputChannel.appendLine(`    env keys: ${interestingEnv}`);
    }
  }

  private formatArgsForLog(args: readonly string[]): string {
    if (!args || args.length === 0) {
      return "";
    }

    return args
      .map(arg => {
        if (/\s/.test(arg) || arg.includes("\"")) {
          return `"${arg.replace(/"/g, '\\"')}"`;
        }
        return arg;
      })
      .join(" ");
  }

  private collectInterestingEnvKeys(action: ActionDefinition, env?: NodeJS.ProcessEnv): string | undefined {
    if (!env) {
      return undefined;
    }

    const interesting = new Set<string>();
    const actionEnvKeys = new Set(action.env.map(variable => variable.key));
    for (const key of Object.keys(env)) {
  if (key.startsWith("SNIP_IT_")) {
        interesting.add(key);
        continue;
      }

      if (key.startsWith("PARAM_")) {
        interesting.add(key);
        continue;
      }

      if (actionEnvKeys.has(key)) {
        interesting.add(key);
      }
    }

    if (interesting.size === 0) {
      return undefined;
    }

    const sorted = Array.from(interesting).sort((a, b) => a.localeCompare(b));
    return sorted.join(", ");
  }

  private resolveBashCommand(): BashCommandInfo {
    if (this.cachedBashInfo) {
      return this.cachedBashInfo;
    }

    if (process.platform !== "win32") {
      this.cachedBashInfo = { command: "bash", implementation: "posix" };
      return this.cachedBashInfo;
    }

    try {
      const result = spawnSync("where", ["bash"], { encoding: "utf8" });
      if (result.status === 0 && result.stdout) {
        const candidates = result.stdout
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0);

        if (candidates.length > 0) {
          const commandPath = candidates[0];
          const lower = commandPath.toLowerCase();
          let implementation: BashImplementation = "other";

          if (lower.includes("\\system32\\bash.exe") || lower.includes("\\system32\\wsl.exe")) {
            implementation = "wsl";
          } else if (lower.includes("\\git\\bin\\bash.exe") || lower.includes("\\git\\usr\\bin\\bash.exe")) {
            implementation = "git-bash";
          }

          this.cachedBashInfo = { command: commandPath, implementation };
          return this.cachedBashInfo;
        }
      }
    } catch (error) {
      console.warn("[Snip It] Failed to resolve bash command:", error);
    }

    this.cachedBashInfo = { command: "bash", implementation: "other" };
    return this.cachedBashInfo;
  }

  private convertScriptPathForBash(scriptPath: string, bashImplementation?: BashImplementation): string {
    if (process.platform !== "win32") {
      return scriptPath;
    }

    if (bashImplementation === "wsl") {
      return this.convertWindowsPathToWsl(scriptPath);
    }

    return this.convertWindowsPathToForwardSlash(scriptPath);
  }

  private convertWindowsPathToWsl(value: string): string {
    if (/^\/mnt\//i.test(value)) {
      return value;
    }

    const driveMatch = value.match(/^([a-zA-Z]):[\\/](.*)$/);
    if (!driveMatch) {
      return this.convertWindowsPathToForwardSlash(value);
    }

    const driveLetter = driveMatch[1].toLowerCase();
    const remainder = driveMatch[2].replace(/\\/g, "/").replace(/^\/+/u, "");
    return `/mnt/${driveLetter}/${remainder}`;
  }

  private convertWindowsPathToForwardSlash(value: string): string {
    return value.replace(/\\/g, "/");
  }

  private normalizePathForShell(
    value: string,
    language: ActionDefinition["language"],
    bashImplementation?: BashImplementation,
  ): string {
    if (language !== "bash" || process.platform !== "win32") {
      return value;
    }

    if (!/^([a-zA-Z]):[\\/]/.test(value)) {
      return value;
    }

    if (value.includes(";")) {
      return value;
    }

    return bashImplementation === "wsl"
      ? this.convertWindowsPathToWsl(value)
      : this.convertWindowsPathToForwardSlash(value);
  }

  private formatTokenValue(
    value: string,
    language: ActionDefinition["language"],
    bashImplementation: BashImplementation | undefined,
    target: "script" | "environment",
  ): string {
    const normalized = this.normalizePathForShell(value, language, bashImplementation);

    if (target === "script" && language === "node" && process.platform === "win32") {
      return normalized.replace(/\\/g, "\\\\");
    }

    return normalized;
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
