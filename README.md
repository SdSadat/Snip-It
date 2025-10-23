# Snip It

Snip It is a VS Code extension that lets you capture repeatable snippets of work as reusable “actions.”

---

## Highlights

- **Action authoring webview** with Monaco editor, parameter builders, environment variables, secrets, and a root-directory picker.
- **Instant test runs** from the editor with output surfaced in-line so you can iterate quickly.
- **Context-aware execution** automatically injects predefined variables (workspace folder, active file path, selection, clipboard, etc.).
- **Flexible output routing** – run in a disposable terminal or stream everything into the dedicated Snip It output channel.
- **Action chaining** to pass stdout from one action as a parameter to the next for simple pipelines.
- **Secret management** built on VS Code’s SecretStorage to keep sensitive values out of plain text.

---


## Using Snip It

### Creating an Action

1. Open the **Snip It** view (Activity Bar → Snip It).
2. Click **New Action**.
3. Fill in the Details form:
   - **Action Name & Description**
   - **Tags** – comma-separated labels used for grouping.
   - **Root Directory** – optional base path; relative imports resolve from here.
   - **Script Language** – choose Bash, PowerShell, Node, or Python.
4. Author your script in the Monaco editor. reference predefined variables such as `${workspaceFolder}`.
5. Add environment variables, mark secrets, and define chained actions if needed.
6. Click **Test Action** to run a dry run from the editor. Output (stdout/stderr) shows in-line, and any necessary secrets/parameters are prompted.
7. Save the action. It appears in the Snip It view and context menus.

### Running Actions

- Trigger from the Snip It tree, the command palette (`Snipt It: Run Action…`), the editor title/context menu, or the explorer.
- Choose whether the action uses a terminal or the Snip It output channel via the “Send output…” checkbox.
- Actions inherit the workspace environment and support relative imports from the configured root directory.

### Action Chaining

- In the **Action Chaining** section, add follow-up actions.
- Optionally set **Pass output as** to name the parameter receiving the previous action’s stdout (trailing newlines are trimmed automatically).
- Chains halt if any action returns a non-zero exit code or throws an error.

### Secrets & Environment Variables

- Mark environment entries as **Secret**; first-time values are persisted to VS Code’s SecretStorage.
- Secrets can be updated from the editor, and Snip It stores them under action-specific keys.
- During execution Secrets resolve to `PARAM_` values or environment variables as appropriate.

---
