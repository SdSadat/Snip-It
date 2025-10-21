import { commands } from "vscode";

export async function setContextKey(key: string, value: unknown): Promise<void> {
  await commands.executeCommand("setContext", key, value);
}
