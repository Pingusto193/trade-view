import { init, getSupportedOverlays } from 'klinecharts';
import { makeCandles, frameStats } from './data.js';
window.bench = async (n) => {
  const el = document.getElementById('c');
  const data = makeCandles(n).map(d => ({ timestamp: d.t*1000, open: d.o, high: d.h, low: d.l, close: d.c, volume: d.v }));
  const t0 = performance.now();
  const chart = init(el);
  chart.setDataLoader({ getBars: ({ callback }) => callback(data, false) });
  chart.setSymbol({ ticker: 'X', pricePrecision: 2, volumePrecision: 0 });
  chart.setPeriod({ span: 1, type: 'day' });
  chart.createIndicator('VOL');
  chart.createIndicator('MA', true, { id: 'candle_pane' });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const firstPaint = performance.now() - t0;
  const times = [];
  for (let i = 0; i < 90; i++) { chart.scrollByDistance(30, 0); await new Promise(r => requestAnimationFrame(t => { times.push(t); r(); })); }
  const scroll = frameStats(times);
  return { firstPaint, scroll, overlays: getSupportedOverlays() };
};
