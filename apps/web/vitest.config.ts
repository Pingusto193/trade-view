import { defineProject } from 'vitest/config';

/** Testes unitários de módulos puros do front (geometria dos desenhos etc.). */
export default defineProject({
  test: {
    name: '@radar/web',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
