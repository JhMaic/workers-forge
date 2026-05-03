// Registers the kit's cloudflare:* stub loader before any module
// (which may statically `import 'cloudflare:workers'`) is evaluated.
import { register } from 'node:module';

register('../dist/internal/loader.mjs', import.meta.url);
