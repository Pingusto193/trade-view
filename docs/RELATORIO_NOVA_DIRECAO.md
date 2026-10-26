# Relatório da nova direção (SPEC §23) — etapas 1 a 4 (26/10/2026)

Formato pedido: em cada etapa, **o que funciona**, **como testar** e **quanto custa por mês (API +
servidor)**. Câmbio usado nas estimativas: US$ 1 = R$ 5,50 (DATA_SOURCES §11.1, 🟡: muda todo dia).

## Custo do servidor (vale para as quatro etapas)

Notícias e placar **exigem servidor ligado 24 h**: hospedagem que hiberna (Render e Koyeb grátis, Fly com
auto-stop) perde notícias, candles e cancela previsões. Opções (DATA_SOURCES §11.1, todas 🟡):

| Opção | R$/mês | Risco |
| --- | --- | --- |
| Oracle Always Free (São Paulo) | 0 | a Oracle pode **parar VM ociosa**; o Radar fica ocupado (notícias a cada 2–5 min), mas não há garantia |
| Oracle Pay As You Go mantendo o grátis | 0 dentro dos limites | pede cartão (pré-autorização de US$ 100); o relato é que a parada por ociosidade só vale para conta grátis (não confirmado) |
| Locaweb VPS 1 GB | 29,90 (15,90 no plano de 24 meses) | IPv4 dedicado e Docker não confirmados |
| Magalu Cloud 1 GB (São Paulo) | 34,99 | — |
| AWS Lightsail 1 GB (São Paulo) | ≈ 44 | — |

**Recomendação:** começar na Oracle grátis (já tem guia) e migrar para um VPS nacional de R$ 30–35/mês se a
VM for parada. Servidor **no Brasil** também ajuda: a API do IBGE (calendário do IPCA) não aceitou conexão
dos EUA. 1 GB de RAM basta (Node + SQLite; previsão e notícias usam pouca memória).

## Etapa 1 — Notícias em tempo real

- **Funciona:** ingestão contínua no servidor (GET condicional, backoff, saúde por fonte), deduplicação
  (URL canônica + títulos parecidos), associação a ativos (código, empresa, setor, moeda, índice, macro),
  atraso medido por fonte (só notícias novas), feed filtrado (Meus ativos, Mini-índice, Mini-dólar, Tudo),
  aviso em tempo real pelo WebSocket, aba Notícias no gráfico e marcadores no candle da publicação, agenda
  Copom/FOMC.
- **Fontes lidas de verdade (GitHub, 26/10/2026):** BCB notas ✅, BCB comunicados do Copom ✅ (com hora
  exata), Fed ✅, Agência Brasil ✅ (feed geral; o de Economia estava parado). **Desligadas:** Nasdaq (não
  responde a robôs), BLS e SEC 8-K (precisam de `SEC_USER_AGENT` com e-mail — pergunta 12).
- **Não há:** fatos relevantes CVM/B3 em tempo real (CVM é semanal; B3 sem API); IPCA, payroll e CPI na
  agenda (IBGE inacessível dos EUA, BLS pede e-mail).
- **Testar:** `pnpm dev` com `RADAR_SIMULATED=1` → Notícias (fonte simulada) e gráfico `sim:SIMBTC` → 📰.
  Produção: Notícias › "Fontes e atraso medido" mostra situação, notícias em 24 h e atraso (mediana/p90).
- **Custo:** R$ 0 de API (fontes gratuitas) + servidor.

## Etapa 2 — Taxas-base condicionais e placar ao vivo

- **Funciona:** painel 📊 Previsão no gráfico (também no modo simples): situação de agora (setup, tendência
  em 3 escalas, ADX, Bollinger), "quando aconteceu antes" com n e intervalo de Wilson, horizontes 1/5/20,
  réguas (moeda, sempre sobe, persistência), histórico de acerto fora da amostra e **SEM VANTAGEM
  COMPROVADA** quando não vence as réguas. Página **Placar**: o servidor grava a previsão no fechamento do
  candle, antes do resultado, e confere sozinho; o banco recusa alterar, conferir duas vezes ou apagar.
  "Seguir no Modo Treino" abre a boleta com o motivo preenchido.
- **Testar:** gráfico → 📊 Previsão → "Acompanhar no placar" → Placar. Em dados simulados (aleatórios) o
  certo é aparecer SEM VANTAGEM COMPROVADA.
- **Custo:** R$ 0 de API (cálculo local) + servidor.

## Etapa 3 — Modelo, validação e calibração

- **Funciona:** regressão logística (19 features do `packages/core`) em walk-forward com purga e embargo,
  Brier, curva de calibração (gráfico + tabela), resultado em dinheiro operando o sinal fora da amostra
  (entra na abertura seguinte, custos do treino, IR da B3) contra "segurar" e o **CDI do mesmo período**;
  o placar ao vivo grava também o modelo. O teste automático confirma que a validação **não acha vantagem
  em passeio aleatório** e acha num padrão determinístico.
- **Testar:** 📊 Previsão → seções "Camada 2", "Calibração" e "Operando o sinal".
- **Custo:** R$ 0 de API + servidor (≈ 1 s de CPU por cálculo de 5.000 candles, no navegador).

## Etapa 4 — Resumo com IA e estudo de evento

- **Funciona:** resumo de 2–3 linhas + relevância + leitura + ativos, **só no servidor**, com a chave do
  Assistente e **limite mensal próprio** checado antes de gastar; a IA recebe só título + trecho do feed e
  só de fontes que permitem. Estudo de evento no painel Notícias do gráfico: o que o preço fez 1/5/20
  candles depois de cada tipo de notícia, com n, contra um candle qualquer, e quanto já tinha acontecido
  antes de a notícia chegar; em ações da B3 no diário, fatos relevantes da CVM dos últimos 5 anos.
- **Testar:** Conta › Assistente (chave e preços) → Notícias › "Resumo por IA" → Ligar. Gráfico → 📰 →
  "Calcular estudo de evento".
- **Custo da IA (estimativa nossa, 🔌 até medir com a sua chave):** ~400 tokens de entrada e 150–400 de saída
  por resumo; ~15–25 notícias elegíveis por dia (oficiais + as que tocam seus ativos) ≈ 450–750 por mês.

| Modelo (preço por milhão de tokens, DATA_SOURCES §17) | Por resumo | Por mês (450–750) |
| --- | --- | --- |
| Claude Opus 5.5 (US$ 4 / 20) | ≈ US$ 0,004–0,010 | ≈ US$ 2–7 (R$ 11–40) |
| Claude Haiku 5.5 (US$ 0,10 / 0,50) | ≈ US$ 0,0001–0,0003 | ≈ US$ 0,05–0,20 (< R$ 1,50) |

  A Anthropic cobra em dólar no cartão: some o IOF (3,5%, 🟡). O limite padrão é US$ 2/mês: com o Opus 5.5 ele pode cortar os resumos antes do fim do mês (o resto
  continua com link). A escolha do modelo é sua (Notícias › Resumo por IA › Modelo).

## Total por mês

| Cenário | API | Servidor | Total |
| --- | --- | --- | --- |
| Mínimo | R$ 0 (sem resumo) | R$ 0 (Oracle grátis) | **R$ 0**, com risco de parada |
| Recomendado | ≈ R$ 1 (resumo com Haiku 5.5) | R$ 30–35 (VPS nacional) | **≈ R$ 31–36** |
| Resumo com Opus 5.5 | R$ 11–40 | R$ 30–35 | **≈ R$ 41–75** |

## O que não está provado (honestidade)

- Nenhuma camada tem vantagem comprovada em ativo real ainda: o placar ao vivo precisa de ≥ 30 previsões
  conferidas por ativo/escala/horizonte (no diário, horizonte 20 = ~600 pregões).
- WIN/WDO: dados só com o agente MT5 ligado (não há fonte grátis permitida de intradiário).
- O atraso medido inclui o intervalo de consulta do Radar (2–15 min por fonte).
