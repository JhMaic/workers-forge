import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ build: vi.fn() }));

vi.mock('../../src/build/build', async (orig) => {
  const actual = await orig<typeof import('../../src/build/build')>();
  return { ...actual, build: mocks.build };
});
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const { spawn } = await import('node:child_process');
const { runCli } = await import('../../src/cli/index');

const FIXTURE_CONFIG = new URL('../fixtures/cli/cf-worker-kit.config.ts', import.meta.url).pathname;

class FakeChild extends EventEmitter {}

function programSpawn(exitCode: number) {
  const calls: { cmd: string; args: string[]; cwd: string }[] = [];
  const spawnMock = spawn as unknown as ReturnType<typeof vi.fn>;
  spawnMock.mockReset();
  spawnMock.mockImplementation((cmd: string, args: string[], opts: any) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    const child = new FakeChild();
    queueMicrotask(() => child.emit('close', exitCode));
    return child as any;
  });
  return { calls };
}

beforeEach(() => {
  mocks.build.mockReset();
  mocks.build.mockResolvedValue({
    deployed: ['m'],
    outputs: ['/tmp/out/m/wrangler.jsonc'],
  });
});

describe('runCli() dev', () => {
  it('routes `dev` to the dev pipeline and returns wrangler exit code', async () => {
    const { calls } = programSpawn(0);
    const code = await runCli(['dev', '--config', FIXTURE_CONFIG]);
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0]).toBe('dev');
  });

  it('forwards CLI --persist-to to wrangler', async () => {
    const { calls } = programSpawn(0);
    await runCli(['dev', '--config', FIXTURE_CONFIG, '--persist-to', '/abs/state']);
    expect(calls[0]!.args).toContain('--persist-to');
    const i = calls[0]!.args.indexOf('--persist-to');
    expect(calls[0]!.args[i + 1]).toBe('/abs/state');
  });

  it('--no-build skips build()', async () => {
    // Use the cli fixture's .build dir — create on the fly.
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const fixtureDir = dirname(FIXTURE_CONFIG);
    const buildDir = join(fixtureDir, '.build', 'm');
    mkdirSync(buildDir, { recursive: true });
    writeFileSync(join(buildDir, 'wrangler.jsonc'), '{}');
    try {
      const { calls } = programSpawn(0);
      const code = await runCli(['dev', '--config', FIXTURE_CONFIG, '--no-build']);
      expect(code).toBe(0);
      expect(mocks.build).not.toHaveBeenCalled();
      expect(calls[0]!.args).toContain('-c');
    }
    finally {
      rmSync(join(fixtureDir, '.build'), { recursive: true, force: true });
    }
  });

  it('rejects passthrough --port (kit-managed) and returns non-zero', async () => {
    programSpawn(0);
    expect(await runCli(['dev', '--config', FIXTURE_CONFIG, '--', '--port', '8788'])).toBe(1);
  });

  it('forwards safe args after `--` to wrangler dev for every child', async () => {
    const { calls } = programSpawn(0);
    await runCli(['dev', '--config', FIXTURE_CONFIG, '--', '--ip', '0.0.0.0']);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls)
      expect(c.args.slice(-2)).toEqual(['--ip', '0.0.0.0']);
  });

  it('rejects unknown own-flag before --', async () => {
    programSpawn(0);
    expect(await runCli(['dev', '--config', FIXTURE_CONFIG, '--bogus'])).toBe(1);
  });

  it('propagates non-zero exit code from wrangler', async () => {
    programSpawn(7);
    const code = await runCli(['dev', '--config', FIXTURE_CONFIG]);
    expect(code).toBe(7);
  });

  it('--persist-to without value returns 1', async () => {
    expect(await runCli(['dev', '--config', FIXTURE_CONFIG, '--persist-to'])).toBe(1);
  });

  it('routes --app names as `only` and starts only the dep closure', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const fixtureDir = dirname(FIXTURE_CONFIG);
    const buildDir = join(fixtureDir, '.build');
    mkdirSync(join(buildDir, 'a'), { recursive: true });
    mkdirSync(join(buildDir, 'b'), { recursive: true });
    writeFileSync(join(buildDir, 'a', 'wrangler.jsonc'), JSON.stringify({ name: 'clitest-a' }));
    writeFileSync(
      join(buildDir, 'b', 'wrangler.jsonc'),
      JSON.stringify({ name: 'clitest-b', services: [{ binding: 'A', service: 'clitest-a' }] }),
    );
    try {
      mocks.build.mockResolvedValue({
        deployed: [],
        outputs: [
          join(buildDir, 'a', 'wrangler.jsonc'),
          join(buildDir, 'b', 'wrangler.jsonc'),
        ],
      });
      const { calls } = programSpawn(0);
      const code = await runCli(['dev', '--config', FIXTURE_CONFIG, '--app', 'b']);
      expect(code).toBe(0);
      const configs = calls.map(c => c.args[c.args.indexOf('-c') + 1]);
      expect(configs.map(c => c!.split('/').slice(-2, -1)[0])).toEqual(['a', 'b']);
    }
    finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });

  it('accepts multiple --app flags', async () => {
    const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const fixtureDir = dirname(FIXTURE_CONFIG);
    const buildDir = join(fixtureDir, '.build');
    mkdirSync(join(buildDir, 'a'), { recursive: true });
    mkdirSync(join(buildDir, 'b'), { recursive: true });
    writeFileSync(join(buildDir, 'a', 'wrangler.jsonc'), JSON.stringify({ name: 'clitest-a' }));
    writeFileSync(join(buildDir, 'b', 'wrangler.jsonc'), JSON.stringify({ name: 'clitest-b' }));
    try {
      mocks.build.mockResolvedValue({
        deployed: [],
        outputs: [
          join(buildDir, 'a', 'wrangler.jsonc'),
          join(buildDir, 'b', 'wrangler.jsonc'),
        ],
      });
      const { calls } = programSpawn(0);
      const code = await runCli(['dev', '--config', FIXTURE_CONFIG, '--app', 'a', '--app', 'b']);
      expect(code).toBe(0);
      expect(calls).toHaveLength(2);
    }
    finally {
      rmSync(buildDir, { recursive: true, force: true });
    }
  });
});
