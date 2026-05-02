import { describe, expect, it } from 'vitest';
import {
  allocatePorts,
  colorFor,
  moduleNameFromOutput,
  prefixLineWriter,
  validatePortConfig,
} from '../../src/build/internal/log-prefix';

describe('moduleNameFromOutput', () => {
  it('extracts the directory name above wrangler.jsonc', () => {
    expect(moduleNameFromOutput('/tmp/.build/crawler/wrangler.jsonc')).toBe('crawler');
    expect(moduleNameFromOutput('a/b/email/wrangler.jsonc')).toBe('email');
  });
});

describe('validatePortConfig', () => {
  it('passes when overrides are subset-of-names with unique in-range ports', () => {
    expect(() => validatePortConfig(['a', 'b'], { a: 8787 })).not.toThrow();
  });
  it('throws on duplicate explicit ports', () => {
    expect(() => validatePortConfig(['a', 'b'], { a: 8787, b: 8787 }))
      .toThrow(/duplicate port 8787/);
  });
  it('throws on out-of-range ports', () => {
    expect(() => validatePortConfig(['a'], { a: 0 })).toThrow(/out of range/);
    expect(() => validatePortConfig(['a'], { a: 70000 })).toThrow(/out of range/);
    expect(() => validatePortConfig(['a'], { a: 1.5 as unknown as number })).toThrow(/integer/);
  });
  it('throws when overrides reference unknown module names', () => {
    expect(() => validatePortConfig(['a'], { ghost: 8787 }))
      .toThrow(/unknown module "ghost"/);
  });
});

describe('allocatePorts', () => {
  it('uses explicit overrides verbatim', async () => {
    const got = await allocatePorts(['a', 'b'], { a: 8787, b: 9000 });
    expect(got).toEqual({ a: 8787, b: 9000 });
  });
  it('assigns a fresh OS-allocated port to modules without overrides', async () => {
    const got = await allocatePorts(['a', 'b', 'c'], { b: 8787 });
    expect(got.b).toBe(8787);
    expect(typeof got.a).toBe('number');
    expect(typeof got.c).toBe('number');
    expect(got.a).toBeGreaterThan(1024);
    expect(got.c).toBeGreaterThan(1024);
    expect(got.a).not.toBe(got.c);
  });
  it('returns only OS-allocated ports when no overrides given', async () => {
    const got = await allocatePorts(['x', 'y'], {});
    expect(got.x).toBeGreaterThan(1024);
    expect(got.y).toBeGreaterThan(1024);
    expect(got.x).not.toBe(got.y);
  });
});

describe('colorFor', () => {
  it('returns a stable ANSI sequence per name', () => {
    expect(colorFor('crawler')).toBe(colorFor('crawler'));
    expect(colorFor('crawler').startsWith('\u001B[')).toBe(true);
  });
});

describe('prefixLineWriter', () => {
  it('prefixes complete lines and buffers incomplete tails', () => {
    const out: string[] = [];
    const write = prefixLineWriter('crawler', (s) => {
      out.push(s);
    });
    write('hello\nwo');
    write('rld\n');
    expect(out.join('')).toMatch(/\[crawler\][^\n]*hello\n.*\[crawler\][^\n]*world\n/s);
  });
  it('flushes a trailing un-newlined buffer when flush() is called', () => {
    const out: string[] = [];
    const write = prefixLineWriter('email', (s) => {
      out.push(s);
    });
    write('partial');
    write.flush();
    expect(out.join('')).toMatch(/\[email\][^\n]*partial\n$/);
  });
  it('handles a stand-alone newline without crashing', () => {
    const out: string[] = [];
    const write = prefixLineWriter('x', (s) => {
      out.push(s);
    });
    write('\n');
    write('next\n');
    expect(out.join('')).toMatch(/\[x\][^\n]*next\n/);
  });
});
