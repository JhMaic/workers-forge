import { readFile } from 'node:fs/promises';

/**
 * Minimal dotenv parser. Supports:
 *   - `KEY=value`
 *   - blank lines and `# comments`
 *   - optional `export KEY=value`
 *   - single- and double-quoted values (with `\n`/`\r`/`\t`/`\\`/`\"` escapes
 *     inside double quotes only)
 *   - inline `# comment` after an unquoted value
 *
 * Intentionally not a full dotenv superset — we don't do variable expansion
 * (`$FOO`) or multi-line values. Callers parsing untrusted env files should
 * be aware of these constraints.
 */

const KEY_REGEX = /^[A-Z_]\w*$/i;

export interface ParsedEnvFile {
  values: Record<string, string>;
}

export function parseEnvFileText(text: string): ParsedEnvFile {
  const values: Record<string, string> = {};
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#'))
      continue;

    const stripped = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const eq = stripped.indexOf('=');
    if (eq < 0)
      continue;

    const key = stripped.slice(0, eq).trim();
    if (!KEY_REGEX.test(key))
      continue;

    let rest = stripped.slice(eq + 1).trim();
    let value: string;

    if (rest.startsWith('"')) {
      const end = findClosingQuote(rest, '"');
      if (end < 0)
        continue;
      value = unescapeDouble(rest.slice(1, end));
    }
    else if (rest.startsWith('\'')) {
      const end = findClosingQuote(rest, '\'');
      if (end < 0)
        continue;
      value = rest.slice(1, end);
    }
    else {
      const hashIdx = rest.indexOf('#');
      if (hashIdx >= 0)
        rest = rest.slice(0, hashIdx).trimEnd();
      value = rest;
    }

    values[key] = value;
  }

  return { values };
}

function findClosingQuote(s: string, q: '"' | '\''): number {
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (q === '"' && ch === '\\') {
      i++;
      continue;
    }
    if (ch === q)
      return i;
  }
  return -1;
}

function unescapeDouble(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

export async function readEnvFile(absPath: string): Promise<ParsedEnvFile> {
  const text = await readFile(absPath, 'utf8');
  return parseEnvFileText(text);
}

/**
 * Reads one or more envFiles and layers them in order — **later files override
 * earlier ones** on key conflicts. Mirrors Vite/Next.js/dotenv-flow semantics.
 *
 * @param absPaths - Absolute paths, evaluated in array order.
 */
export async function readLayeredEnvFiles(
  absPaths: readonly string[],
): Promise<ParsedEnvFile> {
  const merged: Record<string, string> = {};
  for (const p of absPaths) {
    const { values } = await readEnvFile(p);
    Object.assign(merged, values);
  }
  return { values: merged };
}
