import type { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';

export interface WranglerExitInfo { code: number; output: string }

export interface WranglerHandle {
  exit: Promise<WranglerExitInfo>;
  onLine: (cb: (line: string) => void) => void;
  cancel: (sig?: NodeJS.Signals) => void;
}

export function runWrangler(cwd: string, configPath: string, extraArgs: readonly string[] = []): WranglerHandle {
  const child = spawn(
    'wrangler',
    ['deploy', '-c', configPath, ...extraArgs],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32', env: { ...process.env, FORCE_COLOR: '1' } },
  );
  const lineCbs = new Set<(line: string) => void>();
  let buffer = '';
  let stdoutBuf = '';
  let stderrBuf = '';

  const handleChunk = (which: 'out' | 'err', chunk: Buffer | string): void => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    buffer += text;
    if (which === 'out')
      stdoutBuf += text;
    else stderrBuf += text;
    while (true) {
      const i = (which === 'out' ? stdoutBuf : stderrBuf).indexOf('\n');
      if (i < 0)
        break;
      const target = which === 'out' ? stdoutBuf : stderrBuf;
      const line = target.slice(0, i).trimEnd();
      if (which === 'out')
        stdoutBuf = stdoutBuf.slice(i + 1);
      else stderrBuf = stderrBuf.slice(i + 1);
      if (line.length > 0) {
        for (const cb of lineCbs) cb(line);
      }
    }
  };

  child.stdout?.on('data', d => handleChunk('out', d));
  child.stderr?.on('data', d => handleChunk('err', d));

  const exit = new Promise<WranglerExitInfo>((resolve) => {
    let settled = false;
    const finish = (code: number): void => {
      if (settled)
        return;
      settled = true;
      // Defer one macrotask so any pending 'data' events from a mocked stream
      // (or microtask-deferred chunks) drain first, then flush any unterminated
      // trailing line before resolving.
      setImmediate(() => {
        const tailOut = stdoutBuf.trimEnd();
        const tailErr = stderrBuf.trimEnd();
        if (tailOut.length > 0) {
          for (const cb of lineCbs) cb(tailOut);
        }
        if (tailErr.length > 0) {
          for (const cb of lineCbs) cb(tailErr);
        }
        stdoutBuf = '';
        stderrBuf = '';
        resolve({ code, output: buffer });
      });
    };
    child.on('close', code => finish(code ?? 1));
    child.on('error', (err) => {
      buffer += `\n${err.message}`;
      finish(1);
    });
  });

  return {
    exit,
    onLine: cb => void lineCbs.add(cb),
    cancel: (sig = 'SIGTERM') => {
      try {
        child.kill(sig);
      }
      catch {
        /* dead */
      }
    },
  };
}
