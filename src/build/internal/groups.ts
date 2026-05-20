import { WORKER_NAME_MAX_LEN, WORKER_NAME_REGEX } from '../../runtime/constants';

/**
 * A "spawn unit" represents one `wrangler dev` child process.
 *
 *   - A `solo` unit launches a single worker: `wrangler dev -c <one>.jsonc`.
 *   - A `group` unit launches a merged session: `wrangler dev -c <a>.jsonc -c <b>.jsonc …`,
 *     where all members share one dev process (so bindings between them
 *     resolve in-process — useful for queue producer/consumer pairs).
 *
 * `key` is the user-facing identifier: the worker short name for solos, the
 * group name for groups. It is used as the log label and as the `dev.ports`
 * key when the user wants to fix the primary port.
 *
 * `members` is the ordered list of worker short names; the first is the
 * "primary" (its `wrangler.jsonc` becomes the first `-c` flag).
 */
export interface SpawnUnit {
  kind: 'solo' | 'group';
  key: string;
  members: readonly string[];
}

export interface GroupPlan {
  /** Spawn units in declaration order: groups first (declared key order), then solo workers (in `allNames` order). */
  units: SpawnUnit[];
  /** Map from a member worker short name to its containing group's name. Solo workers are absent. */
  groupOf: Map<string, string>;
}

/**
 * Validates `dev.groups` against the discovered worker short names and returns
 * a flat list of spawn units to drive `dev()`.
 *
 * Validation rules (all throw `Error` with explicit messages):
 *   1. Group name must match `WORKER_NAME_REGEX` and fit in `WORKER_NAME_MAX_LEN`
 *      (same rules workers themselves follow — keeps log labels safe).
 *   2. Group name must not collide with any worker short name.
 *   3. A group must have at least 2 members (a 1-member group is a misconfiguration).
 *   4. Members must be unique within a group.
 *   5. Every member must exist in `allNames`.
 *   6. A worker may appear in at most one group.
 */
export function planGroups(
  allNames: readonly string[],
  groups: Readonly<Record<string, readonly string[]>> | undefined,
): GroupPlan {
  const knownWorkers = new Set(allNames);
  const groupOf = new Map<string, string>();
  const groupUnits: SpawnUnit[] = [];

  if (groups) {
    for (const [groupName, members] of Object.entries(groups)) {
      if (!WORKER_NAME_REGEX.test(groupName)) {
        throw new Error(
          `dev.groups name "${groupName}" is invalid: must match ${WORKER_NAME_REGEX} `
          + `(lowercase letters, digits, dashes).`,
        );
      }
      if (groupName.length > WORKER_NAME_MAX_LEN) {
        throw new Error(
          `dev.groups name "${groupName}" exceeds ${WORKER_NAME_MAX_LEN} characters.`,
        );
      }
      if (knownWorkers.has(groupName)) {
        throw new Error(
          `dev.groups name "${groupName}" collides with an existing worker short name; `
          + `pick a different group name.`,
        );
      }
      if (!Array.isArray(members) || members.length < 2) {
        throw new Error(
          `dev.groups["${groupName}"] must list at least 2 worker short names `
          + `(got ${Array.isArray(members) ? members.length : typeof members}). `
          + `For a single worker, omit the group and let it spawn individually.`,
        );
      }
      const seenInGroup = new Set<string>();
      for (const member of members) {
        if (typeof member !== 'string' || member.length === 0) {
          throw new Error(
            `dev.groups["${groupName}"] contains a non-string or empty member.`,
          );
        }
        if (seenInGroup.has(member)) {
          throw new Error(
            `dev.groups["${groupName}"] lists "${member}" more than once.`,
          );
        }
        seenInGroup.add(member);
        if (!knownWorkers.has(member)) {
          throw new Error(
            `dev.groups["${groupName}"] references unknown worker "${member}" `
            + `(known: ${allNames.join(', ')}).`,
          );
        }
        const existingGroup = groupOf.get(member);
        if (existingGroup) {
          throw new Error(
            `worker "${member}" appears in both dev.groups["${existingGroup}"] `
            + `and dev.groups["${groupName}"]; each worker can belong to at most one group.`,
          );
        }
        groupOf.set(member, groupName);
      }
      groupUnits.push({ kind: 'group', key: groupName, members: [...members] });
    }
  }

  const soloUnits: SpawnUnit[] = [];
  for (const name of allNames) {
    if (!groupOf.has(name))
      soloUnits.push({ kind: 'solo', key: name, members: [name] });
  }

  return { units: [...groupUnits, ...soloUnits], groupOf };
}

/**
 * Cross-checks `dev.ports` keys against the group plan. Keys that name a
 * worker which is inside a group are rejected with a hint pointing to the
 * group name (the primary-port knob lives at the group level, not per-member).
 *
 * Keys that don't name any known unit are NOT checked here — that's
 * `validatePortConfig`'s job, called separately by the caller.
 */
export function assertPortKeysNotInsideGroup(
  ports: Readonly<Record<string, number>> | undefined,
  groupOf: ReadonlyMap<string, string>,
): void {
  if (!ports)
    return;
  for (const key of Object.keys(ports)) {
    const group = groupOf.get(key);
    if (group) {
      throw new Error(
        `dev.ports["${key}"] refers to a worker inside group "${group}"; `
        + `use the group name "${group}" as the port key instead.`,
      );
    }
  }
}

/**
 * Expands a worker-level list (typically `--app` + service-binding closure)
 * into a list of spawn-unit keys, preserving order and deduplicating.
 *
 * If any member of a group appears in `workerNames`, the whole group is
 * included (asking for one member of a group launches the entire group).
 */
export function expandWorkersToUnitKeys(
  workerNames: readonly string[],
  groupOf: ReadonlyMap<string, string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of workerNames) {
    const key = groupOf.get(name) ?? name;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}
