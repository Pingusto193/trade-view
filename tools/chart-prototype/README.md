# Protótipo: Lightweight Charts × KLineCharts (Fase 0)

Comparação rápida feita em 12/10/2026 para a decisão registrada em `docs/DECISIONS.md` (ADR-0003).
Fora do workspace pnpm de propósito (não é código do app).

## Como reproduzir

```bash
mkdir /tmp/proto && cp tools/chart-prototype/* /tmp/proto && cd /tmp/proto
npm init -y && npm i lightweight-charts@5.2.1 klinecharts@10.0.3 playwright-core@1.64.0 esbuild
npx esbuild lwc.js --bundle --minify --format=iife --outfile=lwc/bundle.js && cp page.html lwc/index.html
npx esbuild klc.js --bundle --minify --format=iife --outfile=klc/bundle.js && cp page.html klc/index.html
node run.mjs   # ajuste o executablePath do Chromium em run.mjs
```

## Resultado (Chromium headless, 10.000 candles diários, 3 execuções)

| Critério | Lightweight Charts 5.2.1 | KLineCharts 10.0.3 |
|---|---|---|
| Primeira pintura (candles + volume + 4 linhas) | 177 / 190 / 194 ms | 82 / 68 / 84 ms (indicadores calculados pela própria lib) |
| Rolagem: tempo por quadro (mediana / p95) | 16,7 / 16,8 ms (60 fps) | 16,7 / 16,7 ms (60 fps) |
| 2.000 atualizações do último candle | 208–278 ms (~0,1 ms cada) | não medido |
| Tamanho mínimo (gzip) | ~53 KB | ~62 KB |
| Desenhos nativos | nenhum (plugins/primitives) | 16: segmentos, raios, horizontais, verticais, canal paralelo, canal de preço, Fibonacci, anotação, etiqueta, pincel |
| Faltam (precisamos fazer de qualquer jeito) | todos | zona/retângulo, posição comprada/vendida, régua |
| Painéis (ADX, ATR) | nativos na v5 (`addPane`, `paneIndex`) | nativos |
| Sincronizar cursor entre 3 gráficos | `setCrosshairPosition` (API pública) | não encontrado na API pública |
| Licença | Apache-2.0 + exige aviso/link do TradingView (`attributionLogo`) | Apache-2.0 |
| Manutenção | TradingView, comunidade grande | 1 mantenedor principal |

Limitações do teste: headless sem GPU, cargas não idênticas (a KLineCharts calcula médias próprias), toque não
testado em aparelho real.
