import { describe, expect, it } from 'vitest';
import { axisLabels, compact, niceTicks } from './LabCharts';

describe('eixos dos gráficos do laboratório', () => {
  it('marcas redondas cobrindo o intervalo', () => {
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(-3, 7, 4)).toEqual([-2.5, 0, 2.5, 5]);
  });

  it('rótulos nunca se repetem (curva quase reta perto de 10 mil)', () => {
    const t = niceTicks(9_960, 10_040, 4);
    const labels = axisLabels(t, compact);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels).toContain('10.000');
  });

  it('contagens pequenas ganham casas decimais em vez de "1, 1"', () => {
    expect(axisLabels([0, 0.5, 1], (v) => String(Math.round(v)))).toEqual(['0,0', '0,5', '1,0']);
  });
});
