import type { DeployGraph } from '../planner';
import type { DeployRunResult, RunWorkerFn } from '../scheduler';
import { runWithTree } from './tree-runner';
import { runWithVerbose } from './verbose-runner';

export interface PickRunnerOptions {
  verbose?: boolean;
  isTty?: boolean;
  ci?: boolean;
}

export type RunnerFn = (
  graph: DeployGraph,
  runWorker: RunWorkerFn,
  runtimeOpts: { concurrency?: number; signal?: AbortSignal },
) => Promise<DeployRunResult>;

export function pickRunner(opts: PickRunnerOptions = {}): RunnerFn {
  const isTty = opts.isTty ?? !!process.stdout.isTTY;
  const ci = opts.ci ?? !!process.env.CI;
  const noColor = process.env.FORCE_COLOR === '0' || process.env.NO_COLOR != null;
  const useVerbose = opts.verbose || ci || !isTty || noColor;
  if (useVerbose)
    return (g, r, o) => runWithVerbose(g, r, o);
  return (g, r, o) => runWithTree(g, r, o);
}

export { renderAsciiTree } from './ascii-tree';
export { runWithTree } from './tree-runner';
export { runWithVerbose } from './verbose-runner';
