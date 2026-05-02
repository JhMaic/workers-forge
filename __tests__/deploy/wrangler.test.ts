import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const { spawn } = await import('node:child_process');
const { runWrangler } = await import('../../src/deploy/wrangler');

class FakeChild extends EventEmitter {
  kill = vi.fn();
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
}

beforeEach(() => (spawn as unknown as ReturnType<typeof vi.fn>).mockReset());

function programSpawn(): FakeChild {
  const c = new FakeChild();
  (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(c as any);
  return c;
}

describe('runWrangler()', () => {
  it('spawns wrangler deploy with -c, cwd, and extra args', async () => {
    const c = programSpawn();
    const h = runWrangler('/tmp/cwd', '/tmp/cwd/.build/a/wrangler.jsonc', ['--var', 'X=1']);
    expect(spawn).toHaveBeenCalledWith(
      'wrangler',
      ['deploy', '-c', '/tmp/cwd/.build/a/wrangler.jsonc', '--var', 'X=1'],
      expect.objectContaining({ cwd: '/tmp/cwd' }),
    );
    queueMicrotask(() => c.emit('close', 0));
    const r = await h.exit;
    expect(r.code).toBe(0);
  });

  it('captures stdout+stderr into a single output buffer', async () => {
    const c = programSpawn();
    const h = runWrangler('/cwd', '/cwd/a/wrangler.jsonc');
    c.stdout.push('hello\n');
    c.stderr.push('warn\n');
    c.stdout.push(null);
    c.stderr.push(null);
    queueMicrotask(() => c.emit('close', 1));
    const r = await h.exit;
    expect(r.code).toBe(1);
    expect(r.output).toContain('hello');
    expect(r.output).toContain('warn');
  });

  it('invokes onLine for each non-empty line of stdout/stderr', async () => {
    const c = programSpawn();
    const lines: string[] = [];
    const h = runWrangler('/cwd', '/cwd/a/wrangler.jsonc');
    h.onLine(l => lines.push(l));
    c.stdout.push('first\nsecond\n');
    c.stderr.push('err1\n');
    c.stdout.push(null);
    c.stderr.push(null);
    queueMicrotask(() => c.emit('close', 0));
    await h.exit;
    expect(lines).toEqual(expect.arrayContaining(['first', 'second', 'err1']));
  });

  it('cancel() calls kill on the child', async () => {
    const c = programSpawn();
    const h = runWrangler('/cwd', '/cwd/a/wrangler.jsonc');
    h.cancel('SIGTERM');
    expect(c.kill).toHaveBeenCalledWith('SIGTERM');
    queueMicrotask(() => c.emit('close', 130));
    await h.exit;
  });

  it('returns code 1 when child errors before close', async () => {
    const c = programSpawn();
    const h = runWrangler('/cwd', '/cwd/a/wrangler.jsonc');
    queueMicrotask(() => c.emit('error', new Error('ENOENT')));
    const r = await h.exit;
    expect(r.code).toBe(1);
    expect(r.output).toContain('ENOENT');
  });
});
