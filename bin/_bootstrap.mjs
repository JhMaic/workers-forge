// Registers the kit's cloudflare:* stub loader before any TypeScript module
// (which may statically `import 'cloudflare:workers'`) is evaluated.
import { register } from 'node:module';

register('../src/build/internal/loader.mjs', import.meta.url);
