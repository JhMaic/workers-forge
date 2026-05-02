import type { DeployGraph, DeployNode } from './planner';

export type WorkerStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface WorkerRunResult {
  status: 'done' | 'failed';
  output?: string;
}

export type RunWorkerFn = (
  node: DeployNode,
  signal: AbortSignal,
  emitLine: (line: string) => void,
) => Promise<WorkerRunResult>;

export interface SchedulerHooks {
  onStateChange?: (name: string, prev: WorkerStatus, next: WorkerStatus) => void;
  onWorkerOutput?: (name: string, line: string) => void;
}

export interface SchedulerOptions {
  concurrency?: number;
  hooks?: SchedulerHooks;
  signal?: AbortSignal;
}

export interface DeployRunResult {
  done: string[];
  failed: { name: string; output: string }[];
  skipped: { name: string; reason: string }[];
}

export async function runScheduler(
  graph: DeployGraph,
  runWorker: RunWorkerFn,
  opts: SchedulerOptions = {},
): Promise<DeployRunResult> {
  const concurrency = opts.concurrency ?? Infinity;
  const hooks = opts.hooks ?? {};
  const ctrl = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted)
      ctrl.abort();
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }

  const status = new Map<string, WorkerStatus>();
  const remaining = new Map<string, number>();
  for (const [name, node] of graph.nodes) {
    status.set(name, 'pending');
    remaining.set(name, node.deps.length);
  }

  const setStatus = (n: string, next: WorkerStatus): void => {
    const prev = status.get(n)!;
    if (prev === next)
      return;
    status.set(n, next);
    hooks.onStateChange?.(n, prev, next);
  };

  const result: DeployRunResult = { done: [], failed: [], skipped: [] };
  const skipReason = new Map<string, string>();

  const markSkipped = (origin: string, node: DeployNode): void => {
    for (const dep of node.dependents) {
      if (status.get(dep) === 'pending') {
        skipReason.set(dep, origin);
        setStatus(dep, 'skipped');
        markSkipped(origin, graph.nodes.get(dep)!);
      }
    }
  };

  const running = new Set<string>();
  let abortError: Error | undefined;

  return new Promise<DeployRunResult>((resolve, reject) => {
    const failedOutput = new Map<string, string>();

    const tick = (): void => {
      if (abortError)
        return;

      for (const [name, st] of status) {
        if (st !== 'pending')
          continue;
        if ((remaining.get(name) ?? 0) > 0)
          continue;
        if (running.size >= concurrency)
          break;
        running.add(name);
        setStatus(name, 'running');
        const node = graph.nodes.get(name)!;
        const emitLine = (line: string): void => {
          hooks.onWorkerOutput?.(name, line);
        };
        const handleSettled = (r: WorkerRunResult): void => {
          onComplete(name, node, r);
        };
        const handleRejected = (err: unknown): void => {
          if (ctrl.signal.aborted) {
            abortError = err instanceof Error ? err : new Error(String(err));
            running.delete(name);
            reject(abortError);
            return;
          }
          onComplete(name, node, { status: 'failed', output: String((err as Error)?.stack ?? err) });
        };
        runWorker(node, ctrl.signal, emitLine).then(handleSettled, handleRejected);
      }

      if (running.size === 0) {
        for (const [name, st] of status) {
          if (st === 'done') {
            result.done.push(name);
          }
          else if (st === 'failed') {
            const out = failedOutput.get(name) ?? '';
            result.failed.push({ name, output: out });
          }
          else if (st === 'skipped') {
            result.skipped.push({ name, reason: skipReason.get(name) ?? '?' });
          }
        }
        const indexOf = (n: string) => graph.order.indexOf(n);
        result.done.sort((a, b) => indexOf(a) - indexOf(b));
        result.failed.sort((a, b) => indexOf(a.name) - indexOf(b.name));
        result.skipped.sort((a, b) => indexOf(a.name) - indexOf(b.name));
        resolve(result);
      }
    };

    function onComplete(name: string, node: DeployNode, r: WorkerRunResult): void {
      running.delete(name);
      if (r.status === 'done') {
        setStatus(name, 'done');
        for (const dep of node.dependents) remaining.set(dep, (remaining.get(dep) ?? 1) - 1);
      }
      else {
        failedOutput.set(name, r.output ?? '');
        setStatus(name, 'failed');
        markSkipped(name, node);
      }
      tick();
    }

    tick();
  });
}
