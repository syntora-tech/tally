import { err, ok, type Result } from 'neverthrow';

/** `{{path.to.value}}` from spec 7.2; `line.*` resolves against the current table line. */
const PLACEHOLDER = /\{\{([a-z_]+(?:\.[a-z_]+)*)\}\}/g;

export type TemplateData = { [key: string]: unknown; lines?: readonly Record<string, unknown>[] };

export type TemplateError =
  | { code: 'unknown_placeholder'; placeholders: string[] }
  | { code: 'line_outside_table'; placeholders: string[] };

export function placeholdersIn(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''))];
}

export const isLinePlaceholder = (path: string) => path.startsWith('line.');

function lookup(data: unknown, path: string): string | undefined {
  let current: unknown = data;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object' || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === 'string' || typeof current === 'number' ? String(current) : undefined;
}

export function resolvePlaceholder(
  data: TemplateData,
  path: string,
  line?: Record<string, unknown>,
): string | undefined {
  return isLinePlaceholder(path) ? lookup(line, path.slice('line.'.length)) : lookup(data, path);
}

/**
 * Checks every placeholder of a template before anything is rendered: an unknown placeholder is a
 * render error, never an empty string (spec 7.2).
 */
export function validateTemplate(
  data: TemplateData,
  globalText: string,
  lineText: string,
): Result<void, TemplateError> {
  const outside = placeholdersIn(globalText).filter(isLinePlaceholder);
  if (outside.length) return err({ code: 'line_outside_table', placeholders: outside });
  const sampleLine = data.lines?.[0] ?? {};
  const unknown = [...placeholdersIn(globalText), ...placeholdersIn(lineText)].filter(
    (p) => resolvePlaceholder(data, p, sampleLine) === undefined,
  );
  return unknown.length
    ? err({ code: 'unknown_placeholder', placeholders: [...new Set(unknown)] })
    : ok(undefined);
}

export function fillText(text: string, data: TemplateData, line?: Record<string, unknown>) {
  return text.replaceAll(PLACEHOLDER, (match, path: string) => {
    return resolvePlaceholder(data, path, line) ?? match;
  });
}

export function describeTemplateError(e: TemplateError): string {
  return e.code === 'unknown_placeholder'
    ? `Unknown placeholders in template: ${e.placeholders.join(', ')}`
    : `Line placeholders outside the line table row: ${e.placeholders.join(', ')}`;
}
