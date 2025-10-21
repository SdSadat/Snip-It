import * as path from "path";
import { Event, EventEmitter, ExtensionContext } from "vscode";
import { ActionDefinition } from "./actionTypes";
import { ensureDirectoryExists, readJsonFile, writeJsonFile } from "../utils/jsonFile";

const STORAGE_FILE_NAME = "actions.json";

export class ActionStore {
  private readonly storagePath: string;
  private readonly changeEmitter = new EventEmitter<readonly ActionDefinition[]>();
  private cache: readonly ActionDefinition[] | undefined;

  constructor(private readonly context: ExtensionContext) {
    this.storagePath = path.join(context.globalStorageUri.fsPath, STORAGE_FILE_NAME);
  }

  get onDidChange(): Event<readonly ActionDefinition[]> {
    return this.changeEmitter.event;
  }

  async initialize(): Promise<void> {
    await this.loadActions();
  }

  async getAll(): Promise<readonly ActionDefinition[]> {
    if (!this.cache) {
      await this.loadActions();
    }

    return this.cache ?? [];
  }

  async save(action: ActionDefinition): Promise<void> {
    const existing = [...(await this.getAll())];
    const index = existing.findIndex(item => item.id === action.id);
    if (index >= 0) {
      existing[index] = action;
    } else {
      existing.push(action);
    }

    await this.persist(existing);
  }

  async delete(actionId: string): Promise<void> {
    const existing = [...(await this.getAll())];
    const next = existing.filter(item => item.id !== actionId);
    await this.persist(next);
  }

  async overwrite(actions: readonly ActionDefinition[]): Promise<void> {
    await this.persist([...actions]);
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  private async loadActions(): Promise<void> {
    await ensureDirectoryExists(path.dirname(this.storagePath));
    const actions = await readJsonFile<readonly ActionDefinition[]>(this.storagePath, []);
    this.cache = actions.map(action => ({ ...action }));
    this.changeEmitter.fire(this.cache);
  }

  private async persist(actions: readonly ActionDefinition[]): Promise<void> {
    this.cache = actions.map(action => ({ ...action }));
    await writeJsonFile(this.storagePath, this.cache);
    this.changeEmitter.fire(this.cache);
  }
}
