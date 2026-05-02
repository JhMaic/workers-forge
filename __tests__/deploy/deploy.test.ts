import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(), readdir: vi.fn() };
});

const { spawn } = await import('node:child_process');
const fsp = await import('node:fs/promises');
const { deploy } = await import('../../src/deploy/deploy');

class FakeChild extends EventEmitter {
  kill = vi.fn();
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
}

beforeEach(() => {
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReset();
  (fsp.readFile as unknown as ReturnType<typeof vi.fn>).mockReset();
  (fsp.readdir as unknown as ReturnType<typeof vi.fn>).mockReset();
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

function programFs(modules: Record<string, object>): void {
  (fsp.readdir as any).mockResolvedValue(Object.keys(modules).map(name => ({ name, isDirectory: () => true })));
  (fsp.readFile as any).mockImplementation(async (path: string) => {
    const dir = path.replace(/\\/g, '/').split('/').at(-2)!;
    return JSON.stringify(modules[dir]);
  });
}

function programSpawn(exitByModule: Record<string, number>): { calls: string[] } {
  const calls: string[] = [];
  (spawn as any).mockImplementation((_cmd: string, args: string[]) => {
    const cfg = args[args.indexOf('-c') + 1];
    const m = cfg.replace(/\\/g, '/').split('/').at(-2)!;
    calls.push(m);
    const c = new FakeChild();
    queueMicrotask(() => c.emit('close', exitByModule[m] ?? 0));
    return c as any;
  });
  return { calls };
}

describe('deploy()', () => {
  it('happy path: deploys all and returns deployed list', async () => {
    programFs({
      a: { name: 'p-a' },
      b: { name: 'p-b', services: [{ binding: 'A', service: 'p-a' }] },
    });
    const { calls } = programSpawn({ a: 0, b: 0 });
    const r = await deploy({ prefix: 'p-', cwd: '/repo', verbose: true });
    expect(r.deployed.sort()).toEqual(['a', 'b']);
    expect(r.failed).toEqual([]);
    expect(calls.indexOf('a')).toBeLessThan(calls.indexOf('b'));
  });

  it('isolates failure: sibling continues, dependent skipped', async () => {
    programFs({
      a: { name: 'p-a' },
      b: { name: 'p-b' },
      c: { name: 'p-c', services: [{ binding: 'A', service: 'p-a' }] },
    });
    programSpawn({ a: 1, b: 0, c: 0 });
    const r = await deploy({ prefix: 'p-', cwd: '/repo', verbose: true });
    expect(r.deployed).toEqual(['b']);
    expect(r.failed).toEqual(['a']);
    expect(r.skipped).toEqual(['c']);
  });

  it('prints captured wrangler output for failed workers in summary', async () => {
    programFs({ a: { name: 'p-a' } });
    programSpawn({ a: 1 });
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((s: any) => {
      written.push(String(s));
      return true;
    });
    await deploy({ prefix: 'p-', cwd: '/repo', verbose: true });
    const out = written.join('');
    // printSummary must include the failed worker output block
    expect(out).toContain('✖ a');
  });

  it('throws when outDir is empty', async () => {
    (fsp.readdir as any).mockResolvedValue([]);
    await expect(deploy({ prefix: 'p-', cwd: '/repo', verbose: true })).rejects.toThrow(/no build outputs/i);
  });
});
