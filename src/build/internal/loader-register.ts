import {register} from 'node:module';
import {dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let loaderRegistered = false;

/**
 * Registers the `cloudflare:*` stub loader exactly once per process.
 * Called by both `build()` and `gen()` before importing user worker modules
 * (which may contain `import { ... } from 'cloudflare:workers'` etc. that
 * Node cannot resolve natively).
 */
export function ensureLoaderRegistered(): void {
  if (loaderRegistered)
    return;
  try {
    register('./internal/loader.mjs', pathToFileURL(`${__dirname}/`));
    loaderRegistered = true;
  }
  catch (err) {
    console.warn('Failed to register cloudflare:* stub loader', { error: String(err) });
  }
}
