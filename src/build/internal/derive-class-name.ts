/**
 * Derive a runtime class name from a worker `name`.
 *
 * The class name is used in Cloudflare runtime metadata
 * (`durable_objects.bindings[].class_name`, `migrations[].new_sqlite_classes`).
 * It also appears as a named export in the generated entry barrel so workerd
 * can resolve the class from the bundle.
 *
 * Splits on any non-alphanumeric run, capitalizes each segment, joins.
 *
 *   'counter'           → 'Counter'
 *   'my-do'             → 'MyDo'
 *   'user-session-store'→ 'UserSessionStore'
 *   'order_v2'          → 'OrderV2'
 *   'Counter'           → 'Counter'
 */
export function deriveClassName(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(s => s[0]!.toUpperCase() + s.slice(1))
    .join('');
}

const IDENT_REGEX = /^[A-Z_$][\w$]*$/;

export function isValidClassName(s: string): boolean {
  return IDENT_REGEX.test(s);
}
