// Cloudflare worker script names are limited to 63 characters total.
// Module name max length depends on the user-supplied prefix (deploy time).
export const WORKER_NAME_MAX_LEN = 63;
export const WORKER_NAME_REGEX = /^[a-z0-9-]+$/;
export function moduleNameMaxLen(prefix: string): number {
  return WORKER_NAME_MAX_LEN - prefix.length;
}
