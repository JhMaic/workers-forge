import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { basename, dirname } from 'node:path';

/**
 * Asks the OS for a free TCP port by binding to 0 on 127.0.0.1, reading
 * the assigned port, and closing. Small race window between close and the
 * eventual consumer's bind — acceptable in dev.
 */
export async function findFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as AddressInfo | null;
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('failed to obtain a free port')));
        return;
      }
      const { port } = addr;
      srv.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

export function moduleNameFromOutput(output: string): string {
  return basename(dirname(output));
}

const COLORS = [36, 33, 35, 32, 34, 31] as const;
const RESET = '\u001B[0m';

export function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++)
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `\u001B[${COLORS[h % COLORS.length]}m`;
}

export function validatePortConfig(
  names: readonly string[],
  overrides: Readonly<Record<string, number>>,
): void {
  const known = new Set(names);
  const seen = new Map<number, string>();
  for (const [k, v] of Object.entries(overrides)) {
    if (!known.has(k)) {
      throw new Error(
        `dev.ports references unknown module "${k}" (known: ${names.join(', ')})`,
      );
    }
    if (typeof v !== 'number' || !Number.isInteger(v))
      throw new Error(`dev.ports["${k}"] must be an integer (got ${String(v)})`);
    if (v < 1 || v > 65535)
      throw new Error(`dev.ports["${k}"] = ${v} is out of range (1..65535)`);
    const dup = seen.get(v);
    if (dup)
      throw new Error(`dev.ports has duplicate port ${v} for both "${dup}" and "${k}"`);
    seen.set(v, k);
  }
}

export async function allocatePorts(
  names: readonly string[],
  overrides: Readonly<Record<string, number>>,
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(overrides, name))
      out[name] = overrides[name]!;
    else
      out[name] = await findFreePort();
  }
  return out;
}

export interface LineWriter {
  (chunk: string): void;
  flush: () => void;
}

export function prefixLineWriter(label: string, sink: (s: string) => void, colorKey?: string): LineWriter {
  const color = colorFor(colorKey ?? label);
  const prefix = `${color}[${label}]${RESET} `;
  let buf = '';
  const write = ((chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      sink(`${prefix}${line}\n`);
      nl = buf.indexOf('\n');
    }
  }) as LineWriter;
  write.flush = () => {
    if (buf.length > 0) {
      sink(`${prefix}${buf}\n`);
      buf = '';
    }
  };
  return write;
}
