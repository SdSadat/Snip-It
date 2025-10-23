import { SecretStorage } from "vscode";

const SECRET_PREFIX = "snippet";

export class SecretManager {
  constructor(private readonly storage: SecretStorage) {}

  static createSecretKey(actionId: string, envKey: string): string {
    return `${SECRET_PREFIX}:${actionId}:${envKey}`;
  }

  async storeSecret(secretKey: string, value: string): Promise<void> {
    await this.storage.store(secretKey, value);
  }

  async deleteSecret(secretKey: string): Promise<void> {
    await this.storage.delete(secretKey);
  }

  async readSecret(secretKey?: string): Promise<string | undefined> {
    if (!secretKey) {
      return undefined;
    }

    return this.storage.get(secretKey);
  }
}
