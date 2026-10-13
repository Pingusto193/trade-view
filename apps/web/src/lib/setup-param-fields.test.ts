import { DEFAULT_SETUP_PARAMS, setupParamsSchema, type SetupParams } from '@radar/core';
import { describe, expect, it } from 'vitest';
import {
  PARAM_GROUPS,
  changedPaths,
  crossErrors,
  getAt,
  setAt,
  type ParamField,
} from './setup-param-fields';

function leaves(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

const ok = (group: keyof SetupParams, f: ParamField, value: unknown) =>
  setupParamsSchema.safeParse(setAt(DEFAULT_SETUP_PARAMS, `${group}.${f.path}`, value)).success;

describe('campos do editor de parâmetros', () => {
  it('todo parâmetro do schema tem campo, e todo campo existe no schema', () => {
    const fromSchema = leaves(DEFAULT_SETUP_PARAMS).sort();
    const fromEditor = PARAM_GROUPS.flatMap((g) =>
      g.fields.map((f) => `${g.key}.${f.path}`),
    ).sort();
    expect(fromEditor).toEqual(fromSchema);
  });

  it('limites dos números batem com o schema', () => {
    for (const g of PARAM_GROUPS)
      for (const f of g.fields) {
        if (f.kind !== 'number') continue;
        const at = `${g.key}.${f.path}`;
        expect(ok(g.key, f, f.min), `${at} mínimo`).toBe(true);
        expect(ok(g.key, f, f.max), `${at} máximo`).toBe(true);
        expect(ok(g.key, f, f.min - 1e-6), `${at} abaixo do mínimo`).toBe(false);
        expect(ok(g.key, f, f.max + 1e-6), `${at} acima do máximo`).toBe(false);
        if (f.int) expect(ok(g.key, f, f.min + 0.5), `${at} inteiro`).toBe(false);
        expect(typeof getAt(DEFAULT_SETUP_PARAMS[g.key], f.path), at).toBe('number');
      }
  });

  it('opções das listas batem com o schema', () => {
    for (const g of PARAM_GROUPS)
      for (const f of g.fields) {
        if (f.kind === 'enum') {
          for (const o of f.options)
            expect(ok(g.key, f, o.value), `${g.key}.${f.path}=${o.value}`).toBe(true);
          expect(ok(g.key, f, 'xxx')).toBe(false);
          const def = getAt(DEFAULT_SETUP_PARAMS[g.key], f.path);
          expect(f.options.map((o) => o.value)).toContain(def);
        }
        if (f.kind === 'bool')
          expect(typeof getAt(DEFAULT_SETUP_PARAMS[g.key], f.path), `${g.key}.${f.path}`).toBe(
            'boolean',
          );
      }
  });

  it('"só quando" aponta para um campo do mesmo grupo', () => {
    for (const g of PARAM_GROUPS)
      for (const f of g.fields)
        if (f.when)
          expect(
            g.fields.map((x) => x.path),
            `${g.key}.${f.path}`,
          ).toContain(f.when.path);
  });

  it('setAt não altera o original e changedPaths lista só o que mudou', () => {
    const p = setAt(DEFAULT_SETUP_PARAMS, 's91.exit.targetR', 3);
    expect(DEFAULT_SETUP_PARAMS.s91.exit.targetR).toBe(2);
    expect(p.s91.exit.targetR).toBe(3);
    expect(p.s92).toBe(DEFAULT_SETUP_PARAMS.s92);
    expect(changedPaths(DEFAULT_SETUP_PARAMS)).toEqual([]);
    expect(changedPaths(p)).toEqual(['s91.exit.targetR']);
  });

  it('regras entre campos: caixa mínima < máxima, plana < acentuada, volume alto ≤ estrondoso', () => {
    expect(crossErrors(DEFAULT_SETUP_PARAMS)).toEqual([]);
    const box = setAt(DEFAULT_SETUP_PARAMS, 'consolidation.minBars', 40);
    expect(crossErrors(box).map((e) => e.group)).toEqual(['consolidation']);
    const vol = setAt(DEFAULT_SETUP_PARAMS, 'pa.volHuge', 1.5);
    expect(crossErrors(vol)).toEqual([]);
    expect(crossErrors(setAt(vol, 'pa.volHigh', 1.6)).map((e) => e.group)).toEqual(['pa']);
  });
});
