import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('../../src/build/build', async (orig) => {
  const actual = await orig<typeof import('../../src/build/build')>();
  return { ...actual, build: mocks.build };
});
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
const { spawn } = await import('node:child_process');
const { dev } = await import('../../src/dev/dev');

class FakeChild extends EventEmitter {
  kill = vi.fn();
  stdout = new Readable({ read() {} });
  stderr = new Readable({ read() {} });
}

interface SpawnCall {
  cmd: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  child: FakeChild;
}

function programSpawn(exitCodes: number[] | number = 0): { calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
  spawnMock.mockReset();
  spawnMock.mockImplementation((cmd: string, args: string[], opts: any) => {
    const child = new FakeChild();
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env, child });
    const code = Array.isArray(exitCodes) ? (exitCodes[calls.length - 1] ?? 0) : exitCodes;
    queueMicrotask(() => {
      child.stdout.push(null);
      child.stderr.push(null);
      child.emit('close', code);
    });
    return child as any;
  });
  return { calls };
}

beforeEach(() => {
  mocks.build.mockReset();
});

describe('dev() — multi-process', () => {
  it('spawns one `wrangler dev` per output with auto-assigned ports', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a', 'b', 'c'],
      outputs: [
        '/tmp/.build/a/wrangler.jsonc',
        '/tmp/.build/b/wrangler.jsonc',
        '/tmp/.build/c/wrangler.jsonc',
      ],
    });
    const { calls } = programSpawn(0);

    const result = await dev({ prefix: 'p-', cwd: '/tmp' });

    expect(result).toEqual({ exitCode: 0 });
    expect(calls).toHaveLength(3);
    const ports = new Set<string>();
    for (const c of calls) {
      expect(c.cmd).toBe('wrangler');
      expect(c.args[0]).toBe('dev');
      expect(c.args).toContain('--show-interactive-dev-session=false');
      expect(c.env.FORCE_COLOR).toBe('1');
      const port = c.args[c.args.indexOf('--port') + 1]!;
      expect(Number(port)).toBeGreaterThan(1024);
      ports.add(port);
    }
    expect(ports.size).toBe(3);
  });

  it('honors dev.ports overrides; auto-assigns the rest as free ports', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a', 'b', 'c'],
      outputs: [
        '/tmp/.build/a/wrangler.jsonc',
        '/tmp/.build/b/wrangler.jsonc',
        '/tmp/.build/c/wrangler.jsonc',
      ],
    });
    const { calls } = programSpawn(0);

    await dev({ prefix: 'p-', cwd: '/tmp', dev: { ports: { b: 8787 } } });

    const portFor = (i: number) => calls[i]!.args[calls[i]!.args.indexOf('--port') + 1];
    expect(portFor(1)).toBe('8787');
    expect(Number(portFor(0))).toBeGreaterThan(1024);
    expect(Number(portFor(2))).toBeGreaterThan(1024);
  });

  it('rejects dev.ports overrides referencing unknown modules', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a'],
      outputs: ['/tmp/.build/a/wrangler.jsonc'],
    });
    programSpawn(0);
    await expect(dev({ prefix: 'p-', cwd: '/tmp', dev: { ports: { ghost: 8787 } } }))
      .rejects
      .toThrow(/unknown module "ghost"/);
  });

  it('rejects duplicate ports in dev.ports', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a', 'b'],
      outputs: ['/tmp/.build/a/wrangler.jsonc', '/tmp/.build/b/wrangler.jsonc'],
    });
    programSpawn(0);
    await expect(dev({ prefix: 'p-', cwd: '/tmp', dev: { ports: { a: 8787, b: 8787 } } }))
      .rejects
      .toThrow(/duplicate port 8787/);
  });

  it.each([['--port'], ['--inspector-port'], ['--config'], ['-c'], ['--name'], ['--persist-to']])(
    'rejects passthrough flag %s because the kit manages it per child',
    async (flag) => {
      mocks.build.mockResolvedValue({
        deployed: ['a'],
        outputs: ['/tmp/.build/a/wrangler.jsonc'],
      });
      programSpawn(0);
      await expect(dev({ prefix: 'p-', cwd: '/tmp', wranglerArgs: [flag, 'x'] }))
        .rejects
        .toThrow(/managed by workers-forge/);
    },
  );

  it('forwards --persist-to (config) to every child', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a', 'b'],
      outputs: ['/tmp/.build/a/wrangler.jsonc', '/tmp/.build/b/wrangler.jsonc'],
    });
    const { calls } = programSpawn(0);

    await dev({ prefix: 'p-', cwd: '/tmp', dev: { persistTo: './state' } });

    for (const c of calls)
      expect(c.args).toEqual(expect.arrayContaining(['--persist-to', '/tmp/state']));
  });

  it('cLI persistTo overrides config.dev.persistTo for every child', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a'],
      outputs: ['/tmp/.build/a/wrangler.jsonc'],
    });
    const { calls } = programSpawn(0);

    await dev({ prefix: 'p-', cwd: '/tmp', dev: { persistTo: './state' }, persistTo: '/abs/o' });

    expect(calls[0]!.args).toEqual(expect.arrayContaining(['--persist-to', '/abs/o']));
  });

  it('appends safe wranglerArgs after the kit-managed flags on every child', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a', 'b'],
      outputs: ['/tmp/.build/a/wrangler.jsonc', '/tmp/.build/b/wrangler.jsonc'],
    });
    const { calls } = programSpawn(0);

    await dev({ prefix: 'p-', cwd: '/tmp', wranglerArgs: ['--ip', '0.0.0.0'] });

    for (const c of calls)
      expect(c.args.slice(-2)).toEqual(['--ip', '0.0.0.0']);
  });

  it('returns the max exit code across children', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a', 'b', 'c'],
      outputs: [
        '/tmp/.build/a/wrangler.jsonc',
        '/tmp/.build/b/wrangler.jsonc',
        '/tmp/.build/c/wrangler.jsonc',
      ],
    });
    programSpawn([0, 2, 1]);

    const result = await dev({ prefix: 'p-', cwd: '/tmp' });

    expect(result.exitCode).toBe(2);
  });

  it('fails fast: when one child exits non-zero, surviving children are sent SIGTERM', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a', 'b'],
      outputs: ['/tmp/.build/a/wrangler.jsonc', '/tmp/.build/b/wrangler.jsonc'],
    });
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    spawnMock.mockReset();
    const children: FakeChild[] = [];
    spawnMock.mockImplementation(() => {
      const c = new FakeChild();
      children.push(c);
      return c as any;
    });

    const p = dev({ prefix: 'p-', cwd: '/tmp', _spawnDelayMs: 0 });
    while (children.length < 2) await new Promise(r => setImmediate(r));

    children[0]!.emit('close', 1);
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    expect(children[1]!.kill).toHaveBeenCalledWith('SIGTERM');
    children[1]!.emit('close', 0);
    const result = await p;
    expect(result.exitCode).toBe(1);
  });

  it('forwards SIGINT to every spawned child', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a', 'b'],
      outputs: ['/tmp/.build/a/wrangler.jsonc', '/tmp/.build/b/wrangler.jsonc'],
    });
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    spawnMock.mockReset();
    const children: FakeChild[] = [];
    spawnMock.mockImplementation(() => {
      const c = new FakeChild();
      children.push(c);
      return c as any;
    });

    const p = dev({ prefix: 'p-', cwd: '/tmp', _spawnDelayMs: 0 });
    while (children.length < 2) await new Promise(r => setImmediate(r));
    process.emit('SIGINT', 'SIGINT');
    for (const c of children) c.emit('close', 0);
    await p;
    for (const c of children) expect(c.kill).toHaveBeenCalledWith('SIGINT');
  });

  it('returns exitCode 0 without spawning when no outputs', async () => {
    mocks.build.mockResolvedValue({ deployed: [], outputs: [] });
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    spawnMock.mockReset();

    const result = await dev({ prefix: 'p-', cwd: '/tmp' });

    expect(result).toEqual({ exitCode: 0 });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('prefixes child stdout lines with [name:port] before forwarding (via injected sink)', async () => {
    mocks.build.mockResolvedValue({
      deployed: ['a'],
      outputs: ['/tmp/.build/crawler/wrangler.jsonc'],
    });
    const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
    spawnMock.mockReset();
    let child!: FakeChild;
    spawnMock.mockImplementation(() => {
      child = new FakeChild();
      return child as any;
    });

    const out: string[] = [];
    const p = dev(
      { prefix: 'p-', cwd: '/tmp', dev: { ports: { crawler: 8787 } } },
      { stdout: s => out.push(s), stderr: () => {} },
    );
    // eslint-disable-next-line no-unmodified-loop-condition
    while (!child) await new Promise(r => setImmediate(r));
    child.stdout.push('hello world\n');
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    child.stdout.push(null);
    child.stderr.push(null);
    child.emit('close', 0);
    await p;
    expect(out.join('')).toMatch(/\[crawler:8787\][^\n]*hello world\n/);
  });
});

describe('dev() — only (selective startup)', () => {
  // For these tests we need parseServiceDeps to read REAL files, so we
  // write actual wrangler.jsonc files to a tmp dir and have the mocked
  // build return their absolute paths.
  async function setupTmp(
    files: Record<string, object>,
  ): Promise<{ outputs: string[]; cwd: string }> {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const cwd = await mkdtemp(join(tmpdir(), 'dev-only-'));
    const outputs: string[] = [];
    for (const [name, cfg] of Object.entries(files)) {
      const dir = join(cwd, '.build', name);
      await mkdir(dir, { recursive: true });
      const file = join(dir, 'wrangler.jsonc');
      await writeFile(file, JSON.stringify(cfg, null, 2), 'utf-8');
      outputs.push(file);
    }
    return { outputs, cwd };
  }

  it('spawns only the named worker plus its service-binding closure, leaves first', async () => {
    const { outputs, cwd } = await setupTmp({
      'crawler': { name: 'p-crawler' },
      'email': { name: 'p-email' },
      'immi-card-resv': {
        name: 'p-immi-card-resv',
        services: [{ binding: 'CRAWLER', service: 'p-crawler' }],
      },
    });
    mocks.build.mockResolvedValue({ deployed: [], outputs });
    const { calls } = programSpawn(0);

    const result = await dev({
      prefix: 'p-',
      cwd,
      only: ['immi-card-resv'],
      _spawnDelayMs: 0,
    });

    expect(result.exitCode).toBe(0);
    const spawnedConfigs = calls.map(c => c.args[c.args.indexOf('-c') + 1]);
    expect(spawnedConfigs).toEqual([
      outputs.find(o => o.includes('/crawler/')),
      outputs.find(o => o.includes('/immi-card-resv/')),
    ]);
  });

  it('keeps a dep on its full-set port even when started as part of a subset', async () => {
    const { outputs, cwd } = await setupTmp({
      'crawler': { name: 'p-crawler' },
      'email': { name: 'p-email' },
      'immi-card-resv': {
        name: 'p-immi-card-resv',
        services: [{ binding: 'CRAWLER', service: 'p-crawler' }],
      },
    });
    mocks.build.mockResolvedValue({ deployed: [], outputs });
    const { calls } = programSpawn(0);

    await dev({
      prefix: 'p-',
      cwd,
      only: ['immi-card-resv'],
      dev: { ports: { 'crawler': 8787, 'email': 8788, 'immi-card-resv': 8789 } },
      _spawnDelayMs: 0,
    });

    const portFor = (name: string) => {
      const c = calls.find(call => call.args.some(a => a.includes(`/${name}/`)))!;
      return c.args[c.args.indexOf('--port') + 1];
    };
    expect(portFor('crawler')).toBe('8787');
    expect(portFor('immi-card-resv')).toBe('8789');
  });

  it('throws on unknown root', async () => {
    const { outputs, cwd } = await setupTmp({ a: { name: 'p-a' } });
    mocks.build.mockResolvedValue({ deployed: [], outputs });
    programSpawn(0);

    await expect(
      dev({ prefix: 'p-', cwd, only: ['nope'], _spawnDelayMs: 0 }),
    ).rejects.toThrow(/unknown worker "nope"/);
  });

  it('does not forward only to build() — regression for bc9a0eb7', async () => {
    // Regression: before the fix, dev() spread `opts` into buildOpts which
    // inadvertently forwarded `only` to build(). build() would then skip
    // generating configs for non-requested workers, and the dep-closure
    // resolver would throw "unknown worker referenced as dep".
    const { outputs, cwd } = await setupTmp({
      'crawler': { name: 'p-crawler' },
      'immi-card-resv': {
        name: 'p-immi-card-resv',
        services: [{ binding: 'CRAWLER', service: 'p-crawler' }],
      },
    });
    mocks.build.mockResolvedValue({ deployed: [], outputs });
    programSpawn(0);

    await dev({ prefix: 'p-', cwd, only: ['immi-card-resv'], _spawnDelayMs: 0 });

    const buildCallArg = mocks.build.mock.calls[0]![0] as { only?: unknown };
    // build must be called without only so it generates ALL worker configs
    expect(buildCallArg.only == null || (Array.isArray(buildCallArg.only) && buildCallArg.only.length === 0)).toBe(true);
  });

  it('empty only list spawns all (back-compat)', async () => {
    const { outputs, cwd } = await setupTmp({
      a: { name: 'p-a' },
      b: { name: 'p-b' },
    });
    mocks.build.mockResolvedValue({ deployed: [], outputs });
    const { calls } = programSpawn(0);

    await dev({ prefix: 'p-', cwd, only: [], _spawnDelayMs: 0 });
    expect(calls).toHaveLength(2);
  });
});

describe('dev() — X_BROWSER_HEADFUL injection', () => {
  async function setupTmp(
    files: Record<string, object>,
  ): Promise<{ outputs: string[]; cwd: string }> {
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const cwd = await mkdtemp(join(tmpdir(), 'dev-headful-'));
    const outputs: string[] = [];
    for (const [name, cfg] of Object.entries(files)) {
      const dir = join(cwd, '.build', name);
      await mkdir(dir, { recursive: true });
      const file = join(dir, 'wrangler.jsonc');
      await writeFile(file, JSON.stringify(cfg, null, 2), 'utf-8');
      outputs.push(file);
    }
    return { outputs, cwd };
  }

  function envOf(calls: SpawnCall[], modName: string): NodeJS.ProcessEnv {
    const c = calls.find(call => call.args.some(a => a.includes(`/${modName}/`)));
    if (!c)
      throw new Error(`no spawn for ${modName}`);
    return c.env;
  }

  it('injects X_BROWSER_HEADFUL=false for workers with a browser binding', async () => {
    const { outputs, cwd } = await setupTmp({
      crawler: { name: 'p-crawler', browser: { binding: 'MYBROWSER' } },
    });
    mocks.build.mockResolvedValue({ deployed: [], outputs });
    const { calls } = programSpawn(0);

    await dev({ prefix: 'p-', cwd, _spawnDelayMs: 0 });

    expect(envOf(calls, 'crawler').X_BROWSER_HEADFUL).toBe('false');
  });

  it('does not inject X_BROWSER_HEADFUL for workers without a browser binding', async () => {
    const { outputs, cwd } = await setupTmp({
      email: { name: 'p-email' },
    });
    mocks.build.mockResolvedValue({ deployed: [], outputs });
    const { calls } = programSpawn(0);
    const original = process.env.X_BROWSER_HEADFUL;
    delete process.env.X_BROWSER_HEADFUL;
    try {
      await dev({ prefix: 'p-', cwd, _spawnDelayMs: 0 });
      expect(envOf(calls, 'email').X_BROWSER_HEADFUL).toBeUndefined();
    }
    finally {
      if (original !== undefined)
        process.env.X_BROWSER_HEADFUL = original;
    }
  });

  it('preserves user-supplied X_BROWSER_HEADFUL even when worker has a browser binding', async () => {
    const { outputs, cwd } = await setupTmp({
      crawler: { name: 'p-crawler', browser: { binding: 'MYBROWSER' } },
    });
    mocks.build.mockResolvedValue({ deployed: [], outputs });
    const { calls } = programSpawn(0);
    const original = process.env.X_BROWSER_HEADFUL;
    process.env.X_BROWSER_HEADFUL = 'true';
    try {
      await dev({ prefix: 'p-', cwd, _spawnDelayMs: 0 });
      expect(envOf(calls, 'crawler').X_BROWSER_HEADFUL).toBe('true');
    }
    finally {
      if (original === undefined)
        delete process.env.X_BROWSER_HEADFUL;
      else
        process.env.X_BROWSER_HEADFUL = original;
    }
  });
});
