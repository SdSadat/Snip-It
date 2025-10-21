const TOKEN_PATTERN = /\$\{([^}]+)\}/g;

export interface TemplateToken {
  readonly raw: string;
  readonly key: string;
  readonly args: readonly string[];
}

export interface ParameterDescriptor {
  readonly name: string;
  readonly defaultValue?: string;
  readonly prompt?: string;
  readonly raw: string;
}

export function parseTemplateTokens(source: string): readonly TemplateToken[] {
  const matches: TemplateToken[] = [];
  let match: RegExpExecArray | null;

  while ((match = TOKEN_PATTERN.exec(source)) !== null) {
    const expression = match[1];
    const parts = expression.split(":");
    const [key, ...args] = parts;

    matches.push({
      raw: match[0],
      key,
      args,
    });
  }

  return matches;
}

export function extractParameterDescriptors(source: string): readonly ParameterDescriptor[] {
  const tokens = parseTemplateTokens(source);
  const parameters: ParameterDescriptor[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    if (token.key !== "param") {
      continue;
    }

    const [name, defaultValue, prompt] = token.args;
    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    parameters.push({
      name,
      defaultValue,
      prompt,
      raw: token.raw,
    });
  }

  return parameters;
}

export function replaceTemplateTokens(source: string, resolver: (token: TemplateToken) => string | undefined): string {
  return source.replace(TOKEN_PATTERN, match => {
    const withoutDelimiters = match.slice(2, -1);
    const [key, ...args] = withoutDelimiters.split(":");
    const value = resolver({ raw: match, key, args });
    return value ?? match;
  });
}
