import { window } from "vscode";
import { ActionDefinition } from "../actions/actionTypes";
import { extractParameterDescriptors } from "./templateEngine";

export interface ParameterResolutionOptions {
  readonly providedValues?: Record<string, string>;
}

interface ParameterMetadata {
  readonly name: string;
  readonly prompt?: string;
  readonly defaultValue?: string;
  readonly required?: boolean;
}

export class ParameterResolver {
  async resolve(action: ActionDefinition, options: ParameterResolutionOptions = {}): Promise<Record<string, string>> {
    const descriptors = this.combineMetadata(action);
    const results: Record<string, string> = { ...options.providedValues };

    for (const descriptor of descriptors) {
      if (results[descriptor.name] !== undefined) {
        continue;
      }

      const value = await this.promptForValue(descriptor);
      if (value !== undefined) {
        results[descriptor.name] = value;
      }
    }

    return results;
  }

  private combineMetadata(action: ActionDefinition): readonly ParameterMetadata[] {
    const fromDefinition = new Map<string, ParameterMetadata>();

    for (const parameter of action.parameters) {
      fromDefinition.set(parameter.name, {
        name: parameter.name,
        prompt: parameter.prompt,
        defaultValue: parameter.defaultValue,
        required: parameter.required,
      });
    }

    const fromScript = extractParameterDescriptors(action.script);
    for (const token of fromScript) {
      if (!fromDefinition.has(token.name)) {
        fromDefinition.set(token.name, {
          name: token.name,
          prompt: token.prompt,
          defaultValue: token.defaultValue,
          required: true,
        });
      }
    }

    return Array.from(fromDefinition.values());
  }

  private async promptForValue(metadata: ParameterMetadata): Promise<string | undefined> {
    if (metadata.defaultValue && !metadata.required) {
      return metadata.defaultValue;
    }

    return window.showInputBox({
      value: metadata.defaultValue,
      prompt: metadata.prompt ?? `Enter value for ${metadata.name}`,
      ignoreFocusOut: true,
      validateInput: input => {
        if (!input && metadata.required) {
          return "Value is required.";
        }

        return undefined;
      },
    });
  }
}
