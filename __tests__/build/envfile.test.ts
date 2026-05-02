import { describe, expect, it } from 'vitest';
import { parseEnvFileText } from '../../src/build/internal/envfile';

describe('parseEnvFileText', () => {
  it('parses simple KEY=value pairs', () => {
    const { values } = parseEnvFileText('A=1\nB=hello\n');
    expect(values).toEqual({ A: '1', B: 'hello' });
  });

  it('ignores blank lines and # comments', () => {
    const { values } = parseEnvFileText('\n# this is a comment\nA=1\n\n  # indented comment\nB=2\n');
    expect(values).toEqual({ A: '1', B: '2' });
  });

  it('strips inline # comments on unquoted values', () => {
    const { values } = parseEnvFileText('A=hello # tail comment\nB=world#nope\n');
    expect(values).toEqual({ A: 'hello', B: 'world' });
  });

  it('preserves # inside quoted values', () => {
    const { values } = parseEnvFileText('A="hash#inside"\nB=\'also#here\'\n');
    expect(values).toEqual({ A: 'hash#inside', B: 'also#here' });
  });

  it('handles double-quoted escapes \\n \\t \\" \\\\', () => {
    const { values } = parseEnvFileText('A="line1\\nline2\\ttab\\"q\\\\back"\n');
    expect(values.A).toBe('line1\nline2\ttab"q\\back');
  });

  it('does not unescape inside single quotes', () => {
    const { values } = parseEnvFileText('A=\'no\\nescape\'\n');
    expect(values.A).toBe('no\\nescape');
  });

  it('strips `export ` prefix', () => {
    const { values } = parseEnvFileText('export FOO=bar\n');
    expect(values).toEqual({ FOO: 'bar' });
  });

  it('skips invalid keys and lines without =', () => {
    const { values } = parseEnvFileText('1BAD=x\nNO_EQ\nGOOD=ok\n');
    expect(values).toEqual({ GOOD: 'ok' });
  });

  it('skips lines with unterminated quotes', () => {
    const { values } = parseEnvFileText('A="unterminated\nB=ok\n');
    expect(values).toEqual({ B: 'ok' });
  });
});
