# Radar

Plataforma pessoal para **ver** gráficos, receber **alertas**, **planejar** trades, **verificar** se as regras
ensinadas funcionam de verdade (com custos, impostos brasileiros e comparação com o CDI) e **treinar** sem
dinheiro real. Instalável no iPhone e no computador (PWA). **O Radar não envia ordens a corretoras e não
promete lucro.**

> Estado atual: em construção. Veja o andamento em [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Como rodar no seu computador

Passo a passo para quem não é programador: [`docs/GUIA_INSTALACAO_LOCAL.md`](docs/GUIA_INSTALACAO_LOCAL.md).

Resumo para quem já tem Node 22 e pnpm:

```bash
pnpm install
cp .env.example .env
pnpm dev
# abra http://localhost:5173
```

## Documentos

| Documento | Para quê |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Especificação completa (fonte da verdade) |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | O que já foi feito e o que falta |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisões técnicas e de regras, com motivos |
| [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md) | Fontes de dados, limites e o que foi verificado |
| [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) | Perguntas em aberto para você |

## Aviso

Estudo da FGV/USP (Chague, De-Losso e Giovannetti, 2019): entre os day traders do mercado futuro brasileiro
que persistiram por pelo menos 300 dias, **97% perderam dinheiro**. Use o Modo Treino e o laboratório antes de
arriscar dinheiro, e compare sempre com o CDI.

Gráficos: TradingView Lightweight Charts™ — Copyright © TradingView, Inc. — https://www.tradingview.com/
