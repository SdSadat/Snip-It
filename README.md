# Snippet

Snippet turns repetitive terminal snippets into polished, parameterizable automations that you can store, share, and run inside Visual Studio Code.

---

## Why Snippet?

- **Author actions visually** – Build and edit scripts in a purpose-built webview powered by the Monaco editor
- **Inject context automatically** – Use tokens such as `${workspaceFolder}`, `${file}`, `${clipboardText}`, and more without wiring any plumbing yourself.
- **Run and debug instantly** – Test from the editor, stream output inline, or execute in an isolated terminal. Every run is logged to the Snippet output channel for easy diagnostics.
- **Secure by default** – Store API tokens and other secrets via VS Code SecretStorage, never in plain text. Reference them just like any other environment variable.
- **Chain complex flows** – Pipe stdout from one action into the next with simple chaining rules. Stop on failure to keep pipelines safe.
- **Ship everywhere** – Choose Bash, PowerShell, Node.js, or Python scripts and Snippet will handle cross-platform quirks for you.

---

## Features

- Action editor with form-based metadata, tag management, working-directory pickers, and inline validation.
- Environment variable designer with secret toggles and automatic key generation.
- Parameter builder that prompts users at runtime and exposes values via `${paramName}` or `PARAM_NAME`.
- One-click testing that executes actions in a sandbox with your current editor context.
- Output routing to disposable terminals or the dedicated Snippet output channel.
- Execution logs showing command, arguments, interesting environment keys, and exit codes.
- Action chaining with optional output aliasing for lightweight automations.
- Import/export support for sharing actions across teams.

---

## Getting Started

1. Install Snippet from the VS Code Marketplace.
2. Open the **Snippet** view from the Activity Bar.
3. Click **New Action** to launch the editor.
4. Fill in the action details and script body.
5. Add environment variables, mark secrets, and create parameters as needed.
6. Hit **Test Action** to dry-run with your current workspace context.
7. Click **Save Action** once everything looks good.

Actions appear in the Snippet view, the command palette (`Snippet: Run Action...`), and relevant editor/explorer context menus.

---

## Runtime Context

Snippet automatically passes these predefined variables:

- `workspaceFolder` – absolute path of the active workspace root (falls back to the first folder if none is focused).
- `file` – full path of the active editor document, if one is open.
- `relativeFile` – current file path relative to `workspaceFolder`.
- `selectedText` – highlighted text in the active editor (empty when nothing is selected).
- `clipboardText` – snapshot of the system clipboard captured at action start.
- `lineNumber` – 1-based line number of the cursor in the active editor.

During execution Snippet also injects `SNIPPET_ACTION_ID`, `SNIPPET_WORKING_DIRECTORY`, and `PARAM_<NAME>` environment variables. Use them to understand execution state or chain actions together.

---

## Commands

The extension contributes the following commands:

- `Snippet: New Action` – open the action editor for a fresh action.
- `Snippet: Edit Action` – edit the currently selected action from the tree.
- `Snippet: Run Action...` – pick and run an action from a quick pick list.
- `Snippet: Export Actions` – save all actions to a JSON bundle.
- `Snippet: Import Actions` – load actions from a bundle.
- `Snippet: Refresh Actions` – force a reload from disk.

---

## Requirements

- Visual Studio Code 1.84.0 or newer
- Node.js, Python, Bash, or PowerShell available on your PATH depending on the scripts you run
- macOS, Windows, or Linux

Snippet automatically detects virtual environments for Python and handles Windows path normalization when running Bash or Node.js scripts.

---

## Tips

- Use `${paramName}` tokens in scripts to reference parameters defined in the editor.
- Toggle **Send output to Snippet output channel** for deterministic logging.
- When chaining actions, set **Pass output as** to map stdout into the next action's parameters (newline trimmed).
- Secrets marked for removal (set to delete in the editor) must be re-supplied before testing or saving.

---

## Troubleshooting

- **Missing interpreter** – Ensure the relevant runtime (Node.js, Python, Bash, PowerShell) is installed and reachable on PATH.
- **Script path issues on Windows** – Snippet rewrites paths for WSL and Git Bash automatically; if you are using a custom shell, verify it supports standard POSIX-style paths.
- **Permission errors** – Temporary scripts are created in the system temp folder with execute permission. Antivirus tools that block temp execution can interfere with runs.
- **Secrets not found** – Update the secret value from the action editor when prompted; Snippet stores secrets via SecretStorage and never writes them to disk.

Still stuck? Open the output channel named **Snippet** and copy the latest log lines when filing an issue.

---

## Contributing

Bug reports, feature requests, and pull requests are welcome. Please open an issue with reproduction steps or reach out through the repository discussions.

---

## License

Released under the MIT License. See `LICENSE` for details.

---

Happy automating! If Snippet saves you time, please leave a review on the Marketplace.
