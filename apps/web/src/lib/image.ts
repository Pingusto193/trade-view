/**
 * Reduz uma imagem escolhida pelo usuário (print da corretora ou do gráfico) para JPEG em data URL,
 * dentro do limite que o servidor aceita no plano (400 mil caracteres).
 */
export async function imageToDataUrl(
  file: File,
  maxSide = 1280,
  maxChars = 380_000,
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Escolha uma imagem (foto ou print).');
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  let quality = 0.8;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador não consegue reduzir a imagem.');
  for (;;) {
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= maxChars) return url;
    if (quality > 0.45) quality -= 0.15;
    else scale *= 0.75;
    if (scale < 0.05) throw new Error('Imagem grande demais.');
  }
}
