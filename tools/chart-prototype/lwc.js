import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';
import { makeCandles, frameStats } from './data.js';
window.bench = async (n) => {
  const el = document.getElementById('c');
  const data = makeCandles(n);
  const t0 = performance.now();
  const chart = createChart(el, { width: 800, height: 500 });
  const s = chart.addSeries(CandlestickSeries);
  s.setData(data.map(d => ({ time: d.t, open: d.o, high: d.h, low: d.l, close: d.c })));
  const v = chart.addSeries(HistogramSeries, { priceScaleId: 'vol' });
  v.setData(data.map(d => ({ time: d.t, value: d.v })));
  for (let k = 0; k < 4; k++) { const l = chart.addSeries(LineSeries); l.setData(data.map(d => ({ time: d.t, value: d.c }))); }
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const firstPaint = performance.now() - t0;

  const times = [];
  for (let i = 0; i < 90; i++) { chart.timeScale().scrollToPosition(-i * 5, false); await new Promise(r => requestAnimationFrame(t => { times.push(t); r(); })); }
  const scroll = frameStats(times);
  const t1 = performance.now(); let last = data[n-1];
  for (let i = 0; i < 2000; i++) { s.update({ time: last.t, open: last.o, high: last.h + i*0.001, low: last.l, close: last.c + i*0.001 }); }
  await new Promise(r => requestAnimationFrame(r));
  const updates = performance.now() - t1;
  return { firstPaint, scroll, updates2000: updates };
};
