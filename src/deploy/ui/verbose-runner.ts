import type { DeployGraph } from '../planner';
import type { DeployRunResult, RunWorkerFn, WorkerStatus } from '../scheduler';
import { runScheduler } from '../scheduler';

export interface VerboseRunnerOptions {
  concurrency?: number;
  log?: (line: string) => void;
  errorLog?: (line: string) => void;
  signal?: AbortSignal;
}

const ICONS: Record<WorkerStatus, string> = {
  pending: '◌',
  running: '▶',
  done: '✔',
  failed: '✖',
  skipped: '⏭',
};

function ts(): string {
  return new Date().toISOString();
}

export async function runWithVerbose(
  graph: DeployGraph,
  runWorker: RunWorkerFn,
  opts: VerboseRunnerOptions = {},
): Promise<DeployRunResult> {
  const log = opts.log ?? ((l: string) => {
    process.stdout.write(`${l}\n`);
  });
  const err = opts.errorLog ?? ((l: string) => {
    process.stderr.write(`${l}\n`);
  });

  const result = await runScheduler(graph, runWorker, {
    concurrency: opts.concurrency,
    signal: opts.signal,
    hooks: {
      onStateChange: (name, _prev, next) => {
        const node = graph.nodes.get(name)!;
        if (next === 'running')
          log(`[${ts()}] ${ICONS.running} ${node.fullName} started`);
        else if (next === 'done')
          log(`[${ts()}] ${ICONS.done} ${node.fullName} done`);
        else if (next === 'failed')
          err(`[${ts()}] ${ICONS.failed} ${node.fullName} failed`);
        else if (next === 'skipped')
          log(`[${ts()}] ${ICONS.skipped} ${node.fullName} skipped`);
      },
      onWorkerOutput: (name, line) => {
        log(`[${graph.nodes.get(name)!.fullName}] ${line}`);
      },
    },
  });

  return result;
}
