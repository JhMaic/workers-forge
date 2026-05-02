import { describe, expect, it } from 'vitest';
import { triggersToWranglerFields } from '../../src/build/internal/triggers';

describe('triggersToWranglerFields', () => {
  it('returns empty object when triggers undefined', () => {
    expect(triggersToWranglerFields(undefined)).toEqual({});
  });

  it('maps cron string to triggers.crons array', () => {
    expect(triggersToWranglerFields({ cron: '*/5 * * * *' })).toEqual({
      triggers: { crons: ['*/5 * * * *'] },
    });
  });

  it('maps cron string array as-is', () => {
    expect(triggersToWranglerFields({ cron: ['*/5 * * * *', '0 0 * * *'] })).toEqual({
      triggers: { crons: ['*/5 * * * *', '0 0 * * *'] },
    });
  });

  it('maps queue consumers under queues.consumers', () => {
    expect(triggersToWranglerFields({
      queue: { consumers: [{ queue: 'q1', max_batch_size: 10 }] },
    })).toEqual({
      queues: { consumers: [{ queue: 'q1', max_batch_size: 10 }] },
    });
  });

  it('maps tail producers under tail_consumers', () => {
    expect(triggersToWranglerFields({
      tail: { producers: [{ service: 'svc-a' }] },
    })).toEqual({
      tail_consumers: [{ service: 'svc-a' }],
    });
  });

  it('combines all trigger types', () => {
    const out = triggersToWranglerFields({
      cron: '* * * * *',
      queue: { consumers: [{ queue: 'q' }] },
      tail: { producers: [{ service: 's' }] },
    });
    expect(out.triggers).toEqual({ crons: ['* * * * *'] });
    expect(out.queues).toEqual({ consumers: [{ queue: 'q' }] });
    expect(out.tail_consumers).toEqual([{ service: 's' }]);
  });
});
