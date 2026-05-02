import { defineWorker } from '../../../../../src/runtime/define';

export default defineWorker({ name: 'hello' }, {
  async fetch() {
    return new Response('hi');
  },
});
