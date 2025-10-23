const TOKEN_PATTERN = /\$\{([^}]+)\}/g;

export interface TemplateToken {
  readonly raw: string;
  readonly key: string;
  readonly args: readonly string[];
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

export function replaceTemplateTokens(source: string, resolver: (token: TemplateToken) => string | undefined): string {
  return source.replace(TOKEN_PATTERN, match => {
    const withoutDelimiters = match.slice(2, -1);
    const [key, ...args] = withoutDelimiters.split(":");
    const value = resolver({ raw: match, key, args });
    return value ?? match;
  });
}
