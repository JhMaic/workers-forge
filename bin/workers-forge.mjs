#!/usr/bin/env node
// Re-spawn ourselves under tsx so cli.ts can be loaded as TypeScript.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliTs = fileURLToPath(new URL('../src/cli/index.ts', import.meta.url));
const bootstrap = fileURLToPath(new URL('./_bootstrap.mjs', import.meta.url));
const child = spawn(
  process.execPath,
  ['--import', 'tsx/esm', '--import', bootstrap, cliTs, ...process.argv.slice(2)],
  { stdio: 'inherit' },
);
child.on('close', code => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
