import { defineConfig } from '../../../src/build/config';

export default defineConfig({
  prefix: 'clitest-',
  modules: ['modules/*/index.ts'],
});
