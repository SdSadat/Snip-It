import { window } from "vscode";
import { ActionDefinition } from "../actions/actionTypes";

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
    const descriptors = new Map<string, ParameterMetadata>();

    for (const parameter of action.parameters) {
      descriptors.set(parameter.name, {
        name: parameter.name,
        prompt: parameter.prompt,
        defaultValue: parameter.defaultValue,
        required: parameter.required,
      });
    }

    return Array.from(descriptors.values());
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
