import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@radar/core',
    include: ['test/**/*.test.ts'],
  },
});
