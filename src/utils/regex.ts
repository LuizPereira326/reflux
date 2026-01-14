export function match(
  content: string,
  regex: RegExp,
  fallback: string | null = null,
): string | null {
  if (!content) {
    return fallback;
  }

  const match = content.match(regex);
  return match ? match[1] : fallback;
}

export function matches(
  source: string,
  regexes: Record<string, RegExp>,
  fallback: string | null = null,
) {
  if (!source) {
    return fallback;
  }

  for (const [key, regex] of Object.entries(regexes)) {
    if (source.match(regex)) {
      return key;
    }
  }

  return fallback;
}
