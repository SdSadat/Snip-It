import type { Monaco } from "@monaco-editor/react";
import type { editor, languages, Position } from "monaco-editor";
import { ActionEditorParameter, PredefinedVariable } from "./types";

interface CompletionContextSupplier {
  readonly predefined: readonly PredefinedVariable[];
  readonly parameters: readonly ActionEditorParameter[];
}

type ContextSupplier = () => CompletionContextSupplier;

export function createMonacoCompletionProvider(monaco: Monaco, supplier: ContextSupplier): void {
  monaco.languages.registerCompletionItemProvider("shell", createProvider(monaco, supplier));
  monaco.languages.registerCompletionItemProvider("powershell", createProvider(monaco, supplier));
  monaco.languages.registerCompletionItemProvider("python", createProvider(monaco, supplier));
  monaco.languages.registerCompletionItemProvider("javascript", createProvider(monaco, supplier));
}

function createProvider(monaco: Monaco, supplier: ContextSupplier): languages.CompletionItemProvider {
  return {
    triggerCharacters: ["{"],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      if (!textUntilPosition.endsWith("${")) {
        return { suggestions: [] };
      }

      const context = supplier();
      const suggestions: languages.CompletionItem[] = [];

      for (const variable of context.predefined) {
        suggestions.push({
          label: variable.name,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: `${variable.name}}`,
          documentation: variable.description,
          range: new monaco.Range(
            position.lineNumber,
            position.column - 2,
            position.lineNumber,
            position.column
          ),
        });
      }

      for (const parameter of context.parameters) {
        suggestions.push({
          label: `param:${parameter.name}`,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: `param:${parameter.name}}`,
          documentation: parameter.prompt,
          range: new monaco.Range(
            position.lineNumber,
            position.column - 2,
            position.lineNumber,
            position.column
          ),
        });
      }

      return { suggestions };
    },
  };
}
