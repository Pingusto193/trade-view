/** Gráficos abertos, para o plano de trade tirar o print do gráfico certo. */
const shots = new Map<string, () => HTMLCanvasElement>();

export function registerChart(key: string, shot: () => HTMLCanvasElement): () => void {
  shots.set(key, shot);
  return () => {
    if (shots.get(key) === shot) shots.delete(key);
  };
}

/** Print reduzido (JPEG, até 900 px de largura) do gráfico `id|tf`, ou null se não estiver aberto. */
export function chartScreenshot(key: string): string | null {
  const shot = shots.get(key);
  if (!shot) return null;
  try {
    const src = shot();
    const scale = Math.min(1, 900 / Math.max(1, src.width));
    const c = document.createElement('canvas');
    c.width = Math.round(src.width * scale);
    c.height = Math.round(src.height * scale);
    c.getContext('2d')?.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7);
  } catch {
    return null;
  }
}
