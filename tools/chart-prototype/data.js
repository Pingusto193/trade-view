export function makeCandles(n) {
  let p = 100, seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out = []; const t0 = Date.UTC(2000,0,1)/1000;
  for (let i = 0; i < n; i++) { const o = p; const c = o * (1 + (r() - 0.5) * 0.04); const h = Math.max(o,c)*(1+r()*0.01); const l = Math.min(o,c)*(1-r()*0.01); out.push({ t: t0 + i*86400, o, h, l, c, v: Math.round(1e6*r()) }); p = c; }
  return out;
}
export function frameStats(times) { const d = []; for (let i=1;i<times.length;i++) d.push(times[i]-times[i-1]); d.sort((a,b)=>a-b); return { median: d[Math.floor(d.length/2)], p95: d[Math.floor(d.length*0.95)], max: d[d.length-1] }; }
