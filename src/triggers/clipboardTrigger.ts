import { Disposable, env, window } from "vscode";

export type ClipboardActionHandler = (clipboardText: string) => Promise<void>;

const POLL_INTERVAL_MS = 2000;

export class ClipboardTrigger implements Disposable {
  private timer: NodeJS.Timeout | undefined;
  private lastValue = "";
  private disposed = false;

  constructor(private readonly handler: ClipboardActionHandler) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.checkClipboard();
    }, POLL_INTERVAL_MS);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    this.disposed = true;
  }

  private async checkClipboard(): Promise<void> {
    if (this.disposed || !window.state.focused) {
      return;
    }

    const value = await env.clipboard.readText();
    if (value && value !== this.lastValue) {
      this.lastValue = value;
      await this.handler(value);
    }
  }
}
