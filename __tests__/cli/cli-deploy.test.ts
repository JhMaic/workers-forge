import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ deploy: vi.fn(), build: vi.fn() }));
vi.mock('../../src/deploy', () => ({ deploy: mocks.deploy }));
vi.mock('../../src/build/build', async (orig) => {
  const actual = await orig<typeof import('../../src/build/build')>();
  return { ...actual, build: mocks.build };
});

const { runCli } = await import('../../src/cli/index');
const FIXTURE = new URL('../fixtures/cli/workers-forge.config.ts', import.meta.url).pathname;

beforeEach(() => {
  mocks.deploy.mockReset();
  mocks.build.mockReset();
  mocks.deploy.mockResolvedValue({ deployed: [], failed: [], skipped: [] });
  mocks.build.mockResolvedValue({ deployed: [], outputs: [] });
});

describe('cli deploy', () => {
  it('rejects --build and --path together', async () => {
    expect(await runCli(['deploy', '--config', FIXTURE, '--build', '--path', '/x'])).toBe(1);
  });

  it('rejects --env without --build', async () => {
    expect(await runCli(['deploy', '--config', FIXTURE, '--env', 'production'])).toBe(1);
  });

  it('passes --concurrency through to deploy()', async () => {
    expect(await runCli(['deploy', '--config', FIXTURE, '--path', '/tmp/build', '--concurrency', '2'])).toBe(0);
    expect(mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({ concurrency: 2, outDir: '/tmp/build' }));
  });

  it('rejects --concurrency 0', async () => {
    expect(await runCli(['deploy', '--config', FIXTURE, '--path', '/tmp/build', '--concurrency', '0'])).toBe(1);
  });

  it('--build calls build then deploy', async () => {
    expect(await runCli(['deploy', '--config', FIXTURE, '--build'])).toBe(0);
    expect(mocks.build).toHaveBeenCalled();
    expect(mocks.deploy).toHaveBeenCalled();
  });

  it('returns 1 when deploy() reports failures', async () => {
    mocks.deploy.mockResolvedValue({ deployed: ['a'], failed: ['b'], skipped: [] });
    expect(await runCli(['deploy', '--config', FIXTURE, '--path', '/tmp/b'])).toBe(1);
  });

  it('forwards --verbose', async () => {
    await runCli(['deploy', '--config', FIXTURE, '--path', '/x', '--verbose']);
    expect(mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
  });

  it('forwards passthrough wrangler args after --', async () => {
    await runCli(['deploy', '--config', FIXTURE, '--path', '/x', '--', '--var', 'X=1']);
    expect(mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({ wranglerArgs: ['--var', 'X=1'] }));
  });

  it('falls back to cfg.outDir when --path is omitted', async () => {
    const fixtureWithOutDir = new URL('../fixtures/cli/workers-forge.outdir.config.ts', import.meta.url).pathname;
    expect(await runCli(['deploy', '--config', fixtureWithOutDir])).toBe(0);
    expect(mocks.deploy).toHaveBeenCalledWith(expect.objectContaining({ outDir: 'custom-dist' }));
  });
});
