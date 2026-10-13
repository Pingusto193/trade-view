import { TRAIL } from '@radar/shared';
import { describe, expect, it } from 'vitest';
import { LIBRARY_SLUGS } from '../library/catalog';
import { SETUP_IDS } from '@radar/shared';

describe('trilha', () => {
  it('toda leitura aponta para uma página que existe e todo setup é válido', () => {
    for (const m of TRAIL) {
      for (const s of m.read) expect(LIBRARY_SLUGS, `${m.id} → ${s}`).toContain(s);
      for (const s of [...(m.exercises?.setups ?? []), ...(m.replay?.setups ?? [])])
        expect(SETUP_IDS, `${m.id} → ${s}`).toContain(s);
    }
    expect(new Set(TRAIL.map((m) => m.id)).size).toBe(TRAIL.length);
  });
});
