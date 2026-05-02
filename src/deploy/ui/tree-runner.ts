import type { DeployGraph } from '../planner';
import type { DeployRunResult, RunWorkerFn, WorkerStatus } from '../scheduler';
import { runScheduler } from '../scheduler';
import { renderAsciiTree } from './ascii-tree';

export interface TreeRunnerOptions {
  concurrency?: number;
  signal?: AbortSignal;
  /** Override stdout for testing. */
  out?: NodeJS.WriteStream;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

const STATUS_ICON: Record<WorkerStatus, string> = {
  pending: '·',
  running: SPINNER[0], // overridden per-frame
  done: '✔',
  failed: '✖',
  skipped: '⏭',
};

function buildIconMap(state: ReadonlyMap<string, WorkerStatus>, frame: number): Map<string, string> {
  const iconMap = new Map<string, string>();
  for (const [name, status] of state) {
    iconMap.set(name, status === 'running' ? SPINNER[frame % SPINNER.length] : STATUS_ICON[status]);
  }
  return iconMap;
}

export async function runWithTree(
  graph: DeployGraph,
  runWorker: RunWorkerFn,
  opts: TreeRunnerOptions = {},
): Promise<DeployRunResult> {
  const out = opts.out ?? process.stdout;

  const state = new Map<string, WorkerStatus>();
  for (const name of graph.nodes.keys()) state.set(name, 'pending');

  let frame = 0;
  let lastLineCount = 0;

  const render = (): void => {
    if (lastLineCount > 0) {
      out.write(`\x1B[${lastLineCount}A\x1B[0J`);
    }
    const tree = renderAsciiTree(graph, buildIconMap(state, frame));
    lastLineCount = tree.split('\n').length;
    out.write(`${tree}\n`);
  };

  render();

  const interval = setInterval(() => {
    frame++;
    render();
  }, 80);

  const result = await runScheduler(graph, runWorker, {
    concurrency: opts.concurrency,
    signal: opts.signal,
    hooks: {
      onStateChange: (name, _prev, next) => {
        state.set(name, next);
        render();
      },
    },
  });

  clearInterval(interval);

  // Clear the animated tree so deploy.ts printSummary can print the final static tree.
  if (lastLineCount > 0) {
    out.write(`\x1B[${lastLineCount}A\x1B[0J`);
  }

  return result;
}
