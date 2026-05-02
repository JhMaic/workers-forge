#!/usr/bin/env node
// Re-spawn ourselves under tsx so user TypeScript files (config + worker modules)
// can be dynamically imported at runtime.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliJs = fileURLToPath(new URL('../dist/cli/index.js', import.meta.url));
const bootstrap = fileURLToPath(new URL('./_bootstrap.mjs', import.meta.url));
const child = spawn(
  process.execPath,
  ['--import', 'tsx/esm', '--import', bootstrap, cliJs, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
child.on('close', code => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
