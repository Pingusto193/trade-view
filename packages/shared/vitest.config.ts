import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '@radar/shared',
    include: ['test/**/*.test.ts'],
  },
});
