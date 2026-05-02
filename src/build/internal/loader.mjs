// Node module loader hook: resolves `cloudflare:*` specifiers to in-memory
// stub modules so that build-time dynamic `import()` of worker modules
// (which statically import e.g. `cloudflare:workers`, `cloudflare:email`) does
// not crash. The actual values from these modules are never *used* during the
// build — only the worker class metadata is read.
const STUB_PREFIX = 'cloudflare-stub:';

const STUBS = {
  'cloudflare:workers': `
    export class WorkerEntrypoint {
      constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    }
    export class DurableObject {
      constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    }
    export class WorkflowEntrypoint {
      constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    }
    export class RpcTarget {}
    export const env = {};
  `,
  'cloudflare:email': `
    export class EmailMessage {
      constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; }
    }
  `,
  'cloudflare:sockets': `
    export function connect() { throw new Error('cloudflare:sockets stub'); }
  `,
};

const FALLBACK_STUB = `
  const handler = { get: () => () => undefined };
  export default new Proxy({}, handler);
`;

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('cloudflare:')) {
    return {
      url: `${STUB_PREFIX}${specifier}`,
      shortCircuit: true,
      format: 'module',
    };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url.startsWith(STUB_PREFIX)) {
    const specifier = url.slice(STUB_PREFIX.length);
    const source = STUBS[specifier] ?? FALLBACK_STUB;
    return { format: 'module', shortCircuit: true, source };
  }
  return nextLoad(url, context);
}
