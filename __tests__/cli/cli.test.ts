import { describe, expect, it } from 'vitest';
import { runCli } from '../../src/cli/index';

const FIXTURE_CONFIG = new URL('../fixtures/cli/workers-forge.config.ts', import.meta.url).pathname;

describe('runCli()', () => {
  it('returns 1 with usage on missing command', async () => {
    expect(await runCli([])).toBe(1);
  });

  it('returns 1 on unknown command', async () => {
    expect(await runCli(['frobnicate'])).toBe(1);
  });

  it('returns 1 when --config has no value', async () => {
    expect(await runCli(['build', '--config'])).toBe(1);
  });

  it('returns 1 when config file is missing', async () => {
    expect(await runCli(['build', '--config', '/nonexistent/workers-forge.config.ts'])).toBe(1);
  });

  it('runs build successfully with a fixture config', async () => {
    const code = await runCli(['build', '--config', FIXTURE_CONFIG]);
    expect(code).toBe(0);
  });

  it('returns 1 when --env is missing its name argument', async () => {
    expect(await runCli(['deploy', '--config', FIXTURE_CONFIG, '--env'])).toBe(1);
  });

  it('returns 1 when --app is missing its name argument', async () => {
    expect(await runCli(['dev', '--config', FIXTURE_CONFIG, '--app'])).toBe(1);
  });
});
