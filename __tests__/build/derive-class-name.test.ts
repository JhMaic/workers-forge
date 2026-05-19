import { describe, expect, it } from 'vitest';
import { deriveClassName, isValidClassName } from '../../src/build/internal/derive-class-name';

describe('deriveClassName', () => {
  it('capitalizes a single word', () => {
    expect(deriveClassName('counter')).toBe('Counter');
  });

  it('joins kebab-case segments', () => {
    expect(deriveClassName('my-do')).toBe('MyDo');
    expect(deriveClassName('user-session-store')).toBe('UserSessionStore');
  });

  it('joins snake_case segments', () => {
    expect(deriveClassName('order_v2')).toBe('OrderV2');
  });

  it('passes already-PascalCase through unchanged', () => {
    expect(deriveClassName('Counter')).toBe('Counter');
  });

  it('drops non-alphanumeric runs', () => {
    expect(deriveClassName('a--b__c')).toBe('ABC');
  });
});

describe('isValidClassName', () => {
  it('accepts PascalCase identifiers', () => {
    expect(isValidClassName('Counter')).toBe(true);
    expect(isValidClassName('UserSessionStore')).toBe(true);
  });

  it('rejects identifiers starting with digit', () => {
    expect(isValidClassName('123Test')).toBe(false);
  });

  it('rejects identifiers starting with lowercase letter', () => {
    expect(isValidClassName('counter')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidClassName('')).toBe(false);
  });
});
