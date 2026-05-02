import type { DeployGraph } from './planner';
import type { DeployRunResult, RunWorkerFn } from './scheduler';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { loadGraph } from './planner';
import { pickRunner, renderAsciiTree } from './ui';
import { runWrangler } from './wrangler';

export interface DeployOptions {
  cwd?: string;
  prefix: string;
  outDir?: string;
  wranglerArgs?: readonly string[];
  concurrency?: number;
  verbose?: boolean;
}

export interface DeployResult {
  deployed: string[];
  failed: string[];
  skipped: string[];
}

async function listOutputs(outDirAbs: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(outDirAbs, { withFileTypes: true });
  }
  catch (err: any) {
    throw new Error(
      `no build outputs found at ${outDirAbs} (${err?.code ?? 'ENOENT'}). `
      + `Run \`cf-worker-kit deploy --build\` or \`cf-worker-kit build\` first.`,
    );
  }
  const out = entries.filter(e => e.isDirectory()).map(e => join(outDirAbs, e.name, 'wrangler.jsonc')).sort();
  if (out.length === 0)
    throw new Error(`no build outputs found at ${outDirAbs}. Run \`cf-worker-kit deploy --build\` first.`);
  return out;
}

export async function deploy(opts: DeployOptions): Promise<DeployResult> {
  const cwd = resolve(opts.cwd ?? process.cwd());
  const outDirRaw = opts.outDir ?? '.build';
  const outDirAbs = isAbsolute(outDirRaw) ? outDirRaw : resolve(cwd, outDirRaw);

  const outputs = await listOutputs(outDirAbs);
  const graph = await loadGraph(outputs, opts.prefix);

  console.info(`🧭 Deploy plan (${graph.nodes.size} workers):`);

  const runner = pickRunner({ verbose: opts.verbose });
  const runWorker: RunWorkerFn = async (node, signal, emitLine) => {
    const h = runWrangler(cwd, node.configPath, opts.wranglerArgs ?? []);
    h.onLine(emitLine);
    const onAbort = (): void => h.cancel('SIGTERM');
    if (signal.aborted)
      h.cancel('SIGTERM');
    else signal.addEventListener('abort', onAbort, { once: true });
    const { code, output } = await h.exit;
    signal.removeEventListener('abort', onAbort);
    return code === 0 ? { status: 'done' } : { status: 'failed', output };
  };

  const result: DeployRunResult = await runner(graph, runWorker, { concurrency: opts.concurrency });

  printSummary(result, graph);

  return {
    deployed: result.done,
    failed: result.failed.map(f => f.name),
    skipped: result.skipped.map(s => s.name),
  };
}

function printSummary(r: DeployRunResult, graph: DeployGraph): void {
  const log = (s: string): void => {
    process.stdout.write(`${s}\n`);
  };

  // Build icon map for the final status tree.
  const iconMap = new Map<string, string>();
  for (const name of r.done) iconMap.set(name, '✔');
  for (const f of r.failed) iconMap.set(f.name, '✖');
  for (const s of r.skipped) iconMap.set(s.name, '⏭');
  // Any node not yet in the map was somehow not executed — mark with ·
  for (const name of graph.nodes.keys()) {
    if (!iconMap.has(name))
      iconMap.set(name, '·');
  }

  log(renderAsciiTree(graph, iconMap));

  // Print captured output for each failed worker so errors are visible.
  for (const f of r.failed) {
    log(`\n─── ✖ ${f.name} ─────────────────────────`);
    log(f.output);
    log('─────────────────────────────────────────────');
  }
  log('\n─── Deploy summary ───────────────────────────────────');
  if (r.done.length > 0)
    log(`  ✔ deployed: ${r.done.join(', ')}`);
  if (r.failed.length > 0)
    log(`  ✖ failed:   ${r.failed.map(f => f.name).join(', ')}`);
  if (r.skipped.length > 0)
    log(`  ⏭ skipped:  ${r.skipped.map(s => `${s.name} (upstream ${s.reason} failed)`).join(', ')}`);
}
