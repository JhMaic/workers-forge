import type { WorkerTriggers } from '../../runtime/define';

export interface TriggerWranglerFields {
  triggers?: { crons: string[] };
  queues?: { consumers: readonly unknown[] };
  tail_consumers?: readonly unknown[];
}

export function triggersToWranglerFields(
  triggers: WorkerTriggers | undefined,
): TriggerWranglerFields {
  if (!triggers)
    return {};
  const out: TriggerWranglerFields = {};
  if (triggers.cron !== undefined) {
    const crons = Array.isArray(triggers.cron) ? [...triggers.cron] : [triggers.cron];
    out.triggers = { crons };
  }
  if (triggers.queue?.consumers)
    out.queues = { consumers: [...triggers.queue.consumers] };
  if (triggers.tail?.producers)
    out.tail_consumers = [...triggers.tail.producers];
  return out;
}
