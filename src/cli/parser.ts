export function takeValue(args: string[], i: number, flag: string): string {
  const v = args[i + 1];
  if (!v || v.startsWith('--'))
    throw new Error(`${flag} requires a value`);
  return v;
}

export function splitDoubleDash(args: string[]): { own: string[]; passthrough: string[] } {
  const idx = args.indexOf('--');
  if (idx < 0)
    return { own: args, passthrough: [] };
  return { own: args.slice(0, idx), passthrough: args.slice(idx + 1) };
}
