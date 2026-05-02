import { describe, expect, it } from 'vitest';
import { defaultBaseConfig } from '../../src/build/base-config';
import { mergeWranglerConfig } from '../../src/build/internal/merge';

describe('mergeWranglerConfig — env suffix + vars overlay', () => {
  it('appends suffix to the worker name when suffix is set', () => {
    const config = mergeWranglerConfig({
      moduleName: 'demo',
      prefix: 'pfx-',
      sourcePath: 's',
      meta: { name: 'demo' },
      base: defaultBaseConfig,
      suffix: '-local',
    });
    expect(config.name).toBe('pfx-demo-local');
  });

  it('rewrites sibling service bindings with the same suffix', () => {
    const config = mergeWranglerConfig({
      moduleName: 'consumer',
      prefix: 'pfx-',
      sourcePath: 's',
      meta: {
        name: 'consumer',
        bindings: {
          services: {
            SIB: { service: 'producer' },
            EXT: { service: 'external-worker' },
          },
        },
      },
      base: defaultBaseConfig,
      siblings: new Set(['consumer', 'producer']),
      suffix: '-prod',
    });
    expect(config.services).toEqual([
      { binding: 'SIB', service: 'pfx-producer-prod' },
      { binding: 'EXT', service: 'external-worker' },
    ]);
  });

  it('overrides only declared vars (strict overlay); ignores extras', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'p-',
      sourcePath: 's',
      meta: {
        name: 'a',
        bindings: { vars: { API_URL: 'default', DEBUG: 'false' } },
      },
      base: defaultBaseConfig,
      varsOverrides: { API_URL: 'https://prod', UNKNOWN: 'ignored', DEBUG: 'true' },
    });
    expect(config.vars).toEqual({ API_URL: 'https://prod', DEBUG: 'true' });
    expect(config.vars).not.toHaveProperty('UNKNOWN');
  });

  it('does not invent a vars block when worker has no declared vars', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'p-',
      sourcePath: 's',
      meta: { name: 'a', bindings: {} },
      base: defaultBaseConfig,
      varsOverrides: { ANY: 'x' },
    });
    expect(config.vars).toBeUndefined();
  });

  it('leaves declared vars untouched when no override key matches', () => {
    const config = mergeWranglerConfig({
      moduleName: 'a',
      prefix: 'p-',
      sourcePath: 's',
      meta: { name: 'a', bindings: { vars: { K: 'v' } } },
      base: defaultBaseConfig,
      varsOverrides: { OTHER: 'x' },
    });
    expect(config.vars).toEqual({ K: 'v' });
  });
});
