# Fontes de dados e fatos verificados

Este arquivo registra **todo fato sobre o mundo externo** que vira código: endpoints, limites, preços,
versões, regras fiscais e especificações de contrato. Cada linha tem o link e a data da verificação.

## Como ler os selos

| Selo                            | Significado                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| ✅ **VERIFICADO (doc oficial)** | Confirmado na documentação oficial do provedor/órgão, citada no link.                                             |
| 🟡 **PARCIAL**                  | Confirmado por fonte secundária (blog, pacote de terceiros) ou só parte do fato foi confirmada. Usar com cautela. |
| ❌ **NÃO VERIFICADO**           | Não foi possível confirmar. O código usa adaptador/parâmetro para trocar depois.                                  |
| 🔌 **TESTE REAL PENDENTE**      | O formato da API foi lido na documentação, mas nenhuma chamada real foi feita daqui.                              |

> **Limitação do ambiente (12/10/2026):** o ambiente onde o código foi escrito **bloqueia o acesso direto**
> às APIs de mercado (Binance, brapi, BCB, SEC, CVM, Alpaca, Kraken e OKX retornaram 403 do proxy de saída)
> e o acesso direto às páginas de documentação. A verificação foi feita por **busca na web**, que devolve
> resumos de páginas. Por isso, **nenhum adaptador foi testado contra a API real**: todos foram
> desenvolvidos contra fixtures (arquivos em `packages/data/fixtures/`) e os testes de integração reais
> estão marcados com `describe.skipIf(!process.env.RADAR_LIVE_TESTS)`.
> Rode `RADAR_LIVE_TESTS=1 pnpm test:live` numa máquina com internet para validar.

---

## 1. Cripto — Binance (Spot, dados públicos)

| Fato                                                                                                                                                                                                                                                         | Selo        | Fonte                                                                                                                                                                                                        | Data       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| Endpoints públicos de mercado (sem chave) em `https://data-api.binance.vision`, incluindo `GET /api/v3/klines`, `uiKlines`, `ticker/24hr`, `depth`, `trades`.                                                                                                | ✅          | [Market Data Only URLs](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only)                                                                                                     | 12/10/2026 |
| WebSocket só de mercado em `wss://data-stream.binance.vision:443/ws/<símbolo>@kline_<intervalo>` (ex.: `btcusdt@kline_1m`).                                                                                                                                  | ✅          | [Market Data Only URLs](https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only), [WebSocket Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)  | 12/10/2026 |
| Conexão WS vale no máximo 24 h; servidor envia ping a cada 20 s e derruba sem pong em 1 min; limite de 5 mensagens recebidas por segundo do cliente.                                                                                                         | ✅          | [WebSocket Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)                                                                                                            | 12/10/2026 |
| Formato do kline REST: array `[openTime, open, high, low, close, volume, closeTime, quoteVolume, trades, takerBase, takerQuote, ignore]`, preços como string. Evento WS `e: "kline"` com objeto `k` (`t,T,s,i,o,c,h,l,v,x`), onde `x` indica candle fechado. | 🟡          | Conhecimento prévio da API, coerente com a doc; **não lido nesta sessão**                                                                                                                                    | 12/10/2026 |
| Limite de 1000 klines por chamada REST (padrão 500). Peso da chamada.                                                                                                                                                                                        | ❌          | —                                                                                                                                                                                                            | —          |
| Binance bloqueia IPs de regiões restritas (EUA, entre outras) com HTTP 451 citando "Eligibility" dos termos. Servidor deve ficar fora dessas regiões (Brasil preferido).                                                                                     | 🟡          | Relatos em fóruns ([Linode](https://www.linode.com/community/questions/23972/linode-and-binancecom), [Vercel](https://community.vercel.com/t/binance-api-calls-on-vercel/29895)). Termos oficiais não lidos. | 12/10/2026 |
| `data-api.binance.vision` (REST) e `data-stream.binance.vision` (WebSocket, candle de 1m) responderam a partir dos servidores do GitHub Actions (região não informada no log; normalmente EUA). O bloqueio 451 acima vale para `api.binance.com`, que o app não usa — não testado. | ✅ (teste real) | [workflow "Dados reais"](https://github.com/Pingusto193/trade-view/actions/runs/39340445244) | 19/10/2026 |
| O volume é **só o da Binance**, não do mercado cripto inteiro.                                                                                                                                                                                               | ✅ (lógico) | Natureza dos dados                                                                                                                                                                                           | —          |

**Adaptador de reserva:** previsto na interface (`packages/data`), ainda não implementado. Candidatas a verificar: Kraken, OKX, Mercado Bitcoin.

## 2. Ações dos EUA — Alpaca (plano gratuito)

| Fato                                                                                                                                                                                                     | Selo | Fonte                                                                                                                                                       | Data       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Plano gratuito: tempo real **somente feed IEX**, WebSocket com até 30 símbolos.                                                                                                                          | ✅   | [About Market Data API](https://docs.alpaca.markets/docs/about-market-data-api)                                                                             | 12/10/2026 |
| Plano gratuito: histórico consolidado (SIP) disponível se o fim da consulta for **anterior aos últimos 15 minutos**; consultas SIP que terminam nos últimos 15 min dão erro. Limite de 200 chamadas/min. | ✅   | [About Market Data API](https://docs.alpaca.markets/docs/about-market-data-api), [fórum Alpaca](https://forum.alpaca.markets/t/cant-read-spy-minutes/14293) | 12/10/2026 |
| IEX é uma fração do volume total → volume intradiário ao vivo **subestimado** (rotular "parcial").                                                                                                       | ✅   | Mesma doc + [fórum](https://forum.alpaca.markets/t/realtime-data-much-less-dense-than-historical-data/10751)                                                | 12/10/2026 |
| Exige cadastro e chaves (`APCA-API-KEY-ID`, `APCA-API-SECRET-KEY`). Residentes no Brasil podem abrir conta só de dados?                                                                                  | ❌   | —                                                                                                                                                           | —          |
| Endpoint de barras `GET https://data.alpaca.markets/v2/stocks/{symbol}/bars` com `timeframe`, `start`, `end`, `feed`, `adjustment`.                                                                      | 🟡   | Conhecimento prévio; não lido nesta sessão                                                                                                                  | —          |

## 3. B3 atrasada — brapi.dev

| Fato                                                                                                                                                                                                                | Selo                                   | Fonte                                                                                                       | Data       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| Plano gratuito: 15.000 requisições/mês, 1 ticker por chamada.                                                                                                                                                       | 🟡 (página da própria brapi, sem data) | [FAQ limitações](https://brapi.dev/faq/o-plano-gratuito-tem-limitacoes-importantes)                         | 12/10/2026 |
| **Plano gratuito: histórico de apenas 3 meses.** Startup: 1 ano. Pro: completo (10+ anos).                                                                                                                          | 🟡                                     | [FAQ limitações](https://brapi.dev/faq/o-plano-gratuito-tem-limitacoes-importantes)                         | 12/10/2026 |
| Atraso aproximado das cotações: ~30 min no gratuito, 15 min no Startup, 5 min no Pro.                                                                                                                               | 🟡                                     | [FAQ atraso](https://brapi.dev/faq/qual-a-diferenca-real-no-atraso-delay-dos-dados-entre-os-planos)         | 12/10/2026 |
| Preços: Startup R$ 119,99/mês; Pro R$ 139,99/mês.                                                                                                                                                                   | 🟡                                     | [FAQ desconto anual](https://brapi.dev/faq/ha-desconto-para-assinatura-anual-dos-planos-pagos)              | 12/10/2026 |
| Endpoint atual de histórico: `/api/v2/stocks/historical?symbols=PETR4&range=1y&interval=1d`. Endpoint antigo `/api/quote/{ticker}?range=&interval=` com array `historicalDataPrice`. Intervalos `1d`, `1wk`, `1mo`. | 🟡                                     | [Docs](https://brapi.dev/docs), [FAQ timeframes](https://brapi.dev/faq/quais-sao-os-timeframes-disponiveis) | 12/10/2026 |
| Token: a FAQ diz que PETR4 funciona sem token; os exemplos dizem que todos exigem token. **Chave nunca no navegador** (termos).                                                                                     | 🟡 contraditório                       | [Termos](https://brapi.dev/legal/terms-of-use)                                                              | 12/10/2026 |
| **PETR4 sem token funciona**: o histórico diário (`/quote/PETR4?range=3mo&interval=1d`) voltou com dados, sem token. Outros códigos sem token não foram testados; o app continua pedindo token para ligar a brapi. | ✅ (teste real, só PETR4) | [workflow "Dados reais"](https://github.com/Pingusto193/trade-view/actions/runs/39340445244) | 19/10/2026 |

**Consequência para o projeto:** com 3 meses de histórico, o plano gratuito da brapi **não serve para backtest**
(o E1 pede 10 anos). Ver item 4.

## 4. B3 histórico longo — Séries Históricas (COTAHIST) da própria B3

| Fato                                                                                                                                                                             | Selo                                                   | Fonte                                                                                                                                                                                                                                                                         | Data       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| A B3 publica gratuitamente arquivos anuais `COTAHIST_AAAA.ZIP` (texto `COTAHIST.AAAA.TXT`), registros de 245 bytes com header, cotações diárias e trailer, para todos os papéis. | ✅                                                     | [Cotações históricas — B3](https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/historico/mercado-a-vista/cotacoes-historicas/), [Layout (PDF)](https://www.b3.com.br/data/files/33/67/B9/50/D84057102C784E47AC094EA8/SeriesHistoricas_Layout.pdf) | 12/10/2026 |
| Os preços do COTAHIST **não são ajustados** por proventos e desdobramentos.                                                                                                      | 🟡 (nenhuma doc menciona ajuste; consenso de quem usa) | [rb3](https://docs.ropensci.org/rb3/articles/Getting-started.html)                                                                                                                                                                                                            | 12/10/2026 |
| URL de download `https://bvmf.bmfbovespa.com.br/InstDados/SerHist/COTAHIST_D<DDMMAAAA>.ZIP` (diário; anual `COTAHIST_A<AAAA>.ZIP` não testado) e posições de DATA, CODNEG, TPMERC, NOMRES, PREABE, PREMAX, PREMIN, PREULT, TOTNEG, QUATOT e VOLTOT usadas em `cotahist.ts`. Conferido com o arquivo real de 16/10/2026: PETR4 igual à brapi nos 4 preços e na quantidade; financeiro ÷ quantidade (R$ 58,85) entre mínima e máxima. FATCOT, CODBDI e ESPECI não conferidos (PETR4 tem fator 1). | ✅ (teste real) | [workflow "Dados reais"](https://github.com/Pingusto193/trade-view/actions/runs/39340445244), [rb3](https://docs.ropensci.org/rb3/articles/Getting-started.html) | 19/10/2026 |

**Decisão:** o COTAHIST vira o adaptador de histórico diário da B3 para o laboratório (Fase 6), com o selo
"**não ajustado por proventos**" até existir uma fonte de eventos corporativos. Ver ADR-0009.

## 5. Forex

| Fato                                                                                             | Selo                               | Fonte                                                                            | Data       |
| ------------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- | ---------- |
| OANDA v20: candles históricos desde 2005; token pessoal gerado no portal; conta demo disponível. | 🟡                                 | [OANDA Getting Started](https://developer.oanda.com/rest-live-v20/introduction/) | 12/10/2026 |
| OANDA aceita residentes no Brasil?                                                               | ❌                                 | Não encontrado                                                                   | 12/10/2026 |
| Volume em forex = "tick volume" da corretora.                                                    | ✅ (natureza do mercado de balcão) | —                                                                                | —          |
| Mercado de forex abre domingo 17h e fecha sexta 17h, horário de Nova York (24 h por dia nesse intervalo). | 🟡 (fontes secundárias concordam) | [Benzinga](https://benzinga.com/money/forex-trading-hours), [Investing.com](https://investing.com/brokers/guides/forex/can-you-trade-forex-7-days-a-week), [Dukascopy](https://www.dukascopy.com/plugins/fxMarketWatch/forex-market-hours/) | 13/10/2026 |
| A CVM emite alertas frequentes contra corretoras estrangeiras de forex/CFD que captam clientes no Brasil sem autorização (art. 15 da Lei 6.385/76); forex e CFD são tratados como derivativos (art. 2º). A CVM considera o mercado de alto risco. | 🟡 (imprensa citando a CVM; página de alertas da CVM não aberta) | [InfoMoney](https://www.infomoney.com.br/?p=2678997), [Suno](https://www.suno.com.br/noticias/?p=71336) | 13/10/2026 |
| Situação regulatória exata de uma corretora de forex específica para pessoa física no Brasil. | ❌ | Consultar a lista de alertas da CVM antes de abrir conta | — |
| Lote padrão = 100.000 unidades da moeda base; mini = 10.000; micro = 1.000. Pip = 0,0001 (0,01 nos pares cotados em iene). Valor do pip = pip × unidades, na moeda de COTAÇÃO do par (convertido pelo câmbio do momento). Lote mínimo e passo variam por corretora. | 🟡 | [FXCM](https://www.fxcm.com/za/insights/how-is-the-value-of-a-pip-determined/), [BabyPips](https://www.babypips.com/forexpedia/Lot) | 13/10/2026 |

**Decisão (ADR-0023):** forex entra pelo agente MT5 (§16), com selo "tick volume" e janela semanal de Nova York.

**Atualização 20/10/2026 (ADR-0030):** o usuário pediu forex **sem depender do PC Windows**. Pesquisa
feita por busca na web restrita aos domínios oficiais (🟡) e pela leitura dos SDKs oficiais publicados
pelos próprios provedores no GitHub (✅ SDK oficial). Os sites dos provedores estão bloqueados no
ambiente de desenvolvimento; **nenhuma chamada real foi feita daqui** (🔌) — o teste real roda no
workflow "Dados reais" quando o segredo `TWELVE_DATA_KEY` existir.

### 5.1 Twelve Data (padrão do forex pela internet)

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| Plano Basic (US$ 0): **8 créditos por minuto e no máximo 800 por dia**, mais um "trial" de WebSocket. Exige cadastro e chave (`apikey`). | 🟡 | [Pricing](https://twelvedata.com/pricing), [Trial](https://support.twelvedata.com/en/articles/5335783-trial) | 20/10/2026 |
| Acabou a cota do minuto → HTTP 429. Hora em que o teto diário zera: não encontrada. | 🟡 / ❌ | [Credits](https://support.twelvedata.com/en/articles/5615854-credits) | 20/10/2026 |
| `time_series` custa **1 crédito por símbolo** (lote não economiza). | 🟡 | [Batch requests](https://support.twelvedata.com/en/articles/5203360-batch-api-requests) | 20/10/2026 |
| `GET https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=1min&outputsize=N&timezone=UTC&apikey=…`; intervalos `1min, 5min, 15min, 30min, 45min, 1h, 2h, 4h, 8h, 1day, 1week, 1month`. | ✅ (SDK oficial) 🔌 | [twelvedata-python](https://github.com/twelvedata/twelvedata-python) | 20/10/2026 |
| `outputsize` até 5000 candles por chamada. | 🟡 | [Historical data](https://support.twelvedata.com/en/articles/5214728-getting-historical-data) | 20/10/2026 |
| Resposta: `meta` + `values` do mais novo para o mais velho; `datetime` (abertura do candle, sem fuso no texto, no fuso pedido), `open`, `high`, `low`, `close` em texto. **Pares de moeda não trazem `volume`.** Erros vêm como `{"status":"error","code":…,"message":…}`. | 🟡 🔌 | [Docs](https://twelvedata.com/docs) | 20/10/2026 |
| Onde fecha o candle diário de forex (00:00 UTC ou 17h de Nova York). | ❌ | — | — |
| Preços são **médios (mid)** de mercado, não o bid/ask de uma corretora. | 🟡 | [Forex API v2](https://support.twelvedata.com/en/articles/12520817-forex-api-v2) | 20/10/2026 |
| Atraso real do Basic para forex: "tempo real" num artigo, "cobertura US" na tabela de preços. Não medido. | 🟡 contraditório | [Trial](https://support.twelvedata.com/en/articles/5335783-trial), [Forex](https://twelvedata.com/forex) | 20/10/2026 |
| Símbolos no formato `EUR/USD`; existe USD/BRL; EUR/BRL não confirmado. | 🟡 / ❌ | [USD/BRL](https://twelvedata.com/markets/327325/forex/usd-brl) | 20/10/2026 |
| Planos individuais = uso pessoal/interno, sem redistribuição nem exibição a terceiros. App privado de 1 usuário = uso pessoal. | 🟡 | [Commercial and personal usage](https://support.twelvedata.com/en/articles/5332349-commercial-and-personal-usage), [Terms](https://twelvedata.com/terms) | 20/10/2026 |
| Preços desde mar/2026: Grow US$ 79, Pro US$ 229 e Ultra US$ 999 por mês (páginas antigas ainda citam US$ 29). | 🟡 contraditório | [March 2026 updates](https://twelvedata.com/news/march-2026-updates) | 20/10/2026 |
| Restrição a residente no Brasil: nenhuma encontrada. | ❌ | — | — |

### 5.2 Alternativas pesquisadas

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| **OANDA v20 (conta practice)**: candles `/v3/instruments/{instrument}/candles` com mid/bid/ask, `volume` = tick volume, até 5000 por chamada, diário às 17h de Nova York; streaming de preços grátis com a conta. | ✅ (SDK oficial) + 🟡 | [v20-python](https://github.com/oanda/v20-python), [Instrument](https://developer.oanda.com/rest-live-v20/instrument-df/) | 20/10/2026 |
| A lista de países da OANDA Global Markets **não inclui o Brasil**; conta demo com token para brasileiro: não confirmado. | 🟡 / ❌ | [Eligible countries](https://help.oanda.com/bvi/en/faqs/eligible-ogm-countries-bvi.htm) | 20/10/2026 |
| **Massive (ex-Polygon.io)**: Currencies Basic grátis = 5 chamadas/min e dados de **fim de dia**; Currencies Starter **US$ 49/mês** = tempo real, WebSocket, barras pelo bid e tick volume. Uso não profissional fora dos EUA permitido. | 🟡 | [Currencies](https://massive.com/currencies), [Barras de forex](https://massive.com/knowledge-base/article/how-are-massives-forex-bars-built-and-what-do-v-and-n-mean-on-a-forex-bar) | 20/10/2026 |
| **Tiingo** grátis: 50 requisições/hora e 1.000/dia (não aguenta um gráfico a cada 60 s). | 🟡 | [Pricing](https://www.tiingo.com/about/pricing) | 20/10/2026 |
| **Alpha Vantage** grátis: 25 requisições/dia; forex intradiário é premium. | 🟡 | [Documentation](https://www.alphavantage.co/documentation/) | 20/10/2026 |
| **Finnhub**: candles de forex exigem plano pago. | 🟡 | [Forex Candles](https://finnhub.io/docs/api/forex-candles) | 20/10/2026 |
| **TraderMade** (1.000/mês) e **FCS API** (500/mês): cotas grátis pequenas demais. | 🟡 | [TraderMade](https://tradermade.com/docs/restful-api), [FCS](https://fcsapi.com/document/forex-api) | 20/10/2026 |
| BCE/Frankfurter e PTAX do BCB: só taxa diária, sem OHLC — não servem para gráfico. | 🟡 | [Frankfurter](https://frankfurter.dev/providers/ecb/), [PTAX](https://dadosabertos.bcb.gov.br/dataset/taxas-de-cambio-todos-os-boletins-diarios) | 20/10/2026 |

### 5.3 Conta de consumo (Twelve Data grátis)

Gráfico atualizando a cada 60 s **o dia inteiro** = 1.440 créditos/dia: estoura os 800. Por isso o
Radar só consulta enquanto um gráfico de forex está aberto (1 crédito por minuto por gráfico), guarda o
histórico no cache do servidor, conta os créditos (8/min e 800/dia, ajustáveis) e, quando a cota
acaba, mostra o erro e a hora do último dado válido. O scanner não usa esta fonte. Aguenta cerca de
**10 horas de gráfico aberto por dia**. Para mais, plano pago (Massive US$ 49 ou Twelve Data Grow
US$ 79, mais IOF de cartão internacional) ou o MT5.

## 6. Fundamentos

Verificado em 13/10/2026 **só por busca na web**: o ambiente bloqueia `data.sec.gov`, `www.sec.gov` e
`dados.cvm.gov.br` (403 do proxy) e o leitor de páginas não abre esses endereços. Trecho de página
oficial visto pelo buscador = 🟡 (mesma regra do §13). O layout dos CSVs da CVM foi confirmado lendo o
código-fonte de uma biblioteca de terceiros (`pycvm` 0.4.1, baixada do PyPI) = 🟡. **Nenhuma chamada
real foi feita daqui** (🔌): os adaptadores foram escritos contra fixtures feitas à mão.

**Atualização 19/10/2026:** a CVM foi testada de verdade pelo [workflow "Dados reais"](https://github.com/Pingusto193/trade-view/actions/runs/39340445244) (FCA ticker → CNPJ e DFP da
PETR4, com fundamentos calculados) = ✅. A SEC continua 🔌: o teste só roda com o segredo
`SEC_USER_AGENT` ("Seu nome seu@email", exigido pela SEC) cadastrado no GitHub.

### 6.1 SEC EDGAR (ações dos EUA)

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` (CIK com 10 dígitos, zeros à esquerda) devolve todos os fatos XBRL da empresa numa chamada; as APIs do data.sec.gov não pedem chave nem autenticação. | 🟡 (trecho oficial) 🔌 | [SEC — EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces), [data.sec.gov](https://data.sec.gov/) | 13/10/2026 |
| As APIs são atualizadas em tempo real ao longo do dia, conforme os documentos ficam públicos; há também um zip com tudo, refeito toda noite. | 🟡 (trecho oficial) | [SEC — EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | 13/10/2026 |
| Limite de acesso: no máximo **10 requisições por segundo por usuário**, somando todas as máquinas; quem passa disso pode ter o IP limitado por um tempo. | 🟡 (trecho oficial) | [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data), [Developer resources](https://www.sec.gov/about/developer-resources), [anúncio de 27/07/2021](https://www.sec.gov/filergroup/announcements-old/new-rate-control-limits) | 13/10/2026 |
| A SEC pede que todo acesso automático se identifique no cabeçalho **User-Agent**, com nome e e-mail de contato (exemplo oficial: `Sample Company Name AdminContact@<sample company domain>.com`). Sem isso a resposta costuma ser 403. | 🟡 (exemplo oficial visto pelo buscador; o 403 vem de fontes secundárias) | [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data), [edgartools — SEC compliance](https://edgartools.readthedocs.io/en/stable/resources/sec-compliance/) | 13/10/2026 |
| `https://www.sec.gov/files/company_tickers.json` = associação ticker ↔ CIK ↔ nome da empresa. A SEC diz que atualiza "periodicamente" e **não garante exatidão nem abrangência**. | 🟡 (trecho oficial) 🔌 | [SEC — Webmaster FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions), [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data) | 13/10/2026 |
| Formato do `company_tickers.json`: objeto com chaves `"0"`, `"1"`, … e valores `{ "cik_str": 789019, "ticker": "MSFT", "title": "MICROSOFT CORP" }`; `cik_str` sem zeros à esquerda. | 🟡 (secundárias) | [GreenFlux](https://blog.greenflux.us/so-you-want-to-integrate-with-the-sec-api/), [edgar-project #33](https://github.com/ss9077/edgar-project/issues/33) | 13/10/2026 |
| Ações de classe no arquivo da SEC aparecem como `BRK-B` ou `BRK.B`? | ❌ (as duas formas circulam) | [equibles](https://equibles.com/stocks/brk-b/ftd) | 13/10/2026 |
| Estrutura do companyfacts: `facts.{taxonomia}.{tag}.units.{unidade}[]`, cada item com `start` (só em fatos de período), `end`, `val`, `accn` (número do documento), `fy`, `fp`, `form`, `filed` (data de entrega) e às vezes `frame`. LPA na unidade `USD/shares`; receita em `USD`. A mesma tag mistura valores anuais (10-K) e trimestrais (10-Q). | 🟡 (páginas companyconcept do data.sec.gov vistas pelo buscador + exemplos de terceiros) | [companyconcept — exemplo](https://data.sec.gov/api/xbrl/companyconcept/CIK0002064953/us-gaap/EarningsPerShareBasic.json), [tldrfiling](https://tldrfiling.com/blog/free-sec-edgar-api-guide/) | 13/10/2026 |
| Um 10-K repete os anos anteriores (comparativos) com o `fy`/`fp` do próprio relatório: o período certo sai de `start`/`end`, e quem usa a API deduplica pelo `end` ficando com o `filed` mais recente. | 🟡 (prática relatada por terceiros) | [tldrfiling — tutorial](https://tldrfiling.com/blog/sec-edgar-xbrl-api-python-tutorial) | 13/10/2026 |
| Fatos aparecem em várias taxonomias (`us-gaap`, `dei`, `ifrs-full`): estrangeiras que entregam 20-F podem usar `ifrs-full` e outra moeda. | 🟡 (secundária) | [wiki SEC EDGAR API](https://moltchat-agent-commons.onrender.com/wiki/SEC_EDGAR_API_company_facts_and_filings) | 13/10/2026 |
| Tag do LPA: `us-gaap:EarningsPerShareBasic` ("Earnings Per Share, Basic"). | 🟡 (companyconcept visto pelo buscador) | [companyconcept — exemplo](https://data.sec.gov/api/xbrl/companyconcept/CIK0001943421/us-gaap/EarningsPerShareBasic.json) | 13/10/2026 |
| Tags de receita: `RevenueFromContractWithCustomerExcludingAssessedTax` (ASC 606, adotado em 2018); `Revenues` para o total quando há receita fora do ASC 606. | 🟡 | [FASB — guia de receita](https://xbrl.fasb.org/impguidance/Rev2_TIG/revenue_2.pdf), [XBRL US — guid-revenue](https://xbrl.us/data-rule/guid-revenue/) | 13/10/2026 |
| Tags `SalesRevenueNet` (antiga, antes do ASC 606), `RevenueFromContractWithCustomerIncludingAssessedTax` e `EarningsPerShareBasicAndDiluted`. | ❌ (conhecimento prévio, não conferido) | — | — |

### 6.2 CVM — Dados Abertos (empresas da B3)

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| DFP (demonstrações anuais) em um zip por **ano de referência**: `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_AAAA.zip`, de 2010 até o ano atual; ~12 a 13 MB cada (2024 e 2025). | 🟡 (índice do diretório visto pelo buscador) 🔌 | [Índice DFP/DADOS](https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/) | 13/10/2026 |
| Atualização **semanal**, "com as eventuais reapresentações"; o conjunto traz as demonstrações entregues nos últimos 5 anos, DRE incluída. | 🟡 (trecho oficial) | [Conjunto DFP](https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp) | 13/10/2026 |
| Dentro do zip: `dfp_cia_aberta_AAAA.csv` (índice dos documentos) e `dfp_cia_aberta_DRE_con_AAAA.csv` / `dfp_cia_aberta_DRE_ind_AAAA.csv` (DRE consolidada e individual), entre outros. | 🟡 (código do pycvm + tutorial) | [pycvm 0.4.1 (PyPI)](https://pypi.org/project/pycvm/), [Análise Macro](https://analisemacro.com.br/mercado-financeiro/como-analisar-demonstrativos-financeiros-e-dados-da-cvm/) | 13/10/2026 |
| CSV separado por `;`, codificação **ISO-8859-1**, datas `AAAA-MM-DD`. | 🟡 (código do pycvm) | [pycvm 0.4.1 (PyPI)](https://pypi.org/project/pycvm/) | 13/10/2026 |
| Colunas da DRE: `CNPJ_CIA`, `DT_REFER`, `VERSAO`, `GRUPO_DFP`, `MOEDA`, `ESCALA_MOEDA`, `ORDEM_EXERC`, `DT_INI_EXERC`, `DT_FIM_EXERC`, `CD_CONTA`, `DS_CONTA`, `VL_CONTA`, `ST_CONTA_FIXA` (e `DENOM_CIA`, `CD_CVM`). `ORDEM_EXERC` = `ÚLTIMO` (ano do documento) ou `PENÚLTIMO` (ano anterior, comparativo). `ESCALA_MOEDA` = `UNIDADE` ou `MIL`; `MOEDA` = `REAL`. | 🟡 (código do pycvm; `ESCALA_MOEDA` e `MOEDA` também nas novidades da CVM: `ESCALA_DRE` virou `ESCALA_MOEDA` em 2019) | [pycvm 0.4.1 (PyPI)](https://pypi.org/project/pycvm/), [CVM — Novidades](https://dados.cvm.gov.br/pages/novidades) | 13/10/2026 |
| Colunas do índice: `CNPJ_CIA`, `DT_REFER`, `VERSAO`, `DENOM_CIA`, `CD_CVM`, `CATEG_DOC`, `ID_DOC`, `DT_RECEB`, `LINK_DOC`. O Radar usa `DT_RECEB` (data de recebimento pela CVM) como data em que o balanço ficou público. | 🟡 (código do pycvm; o significado de `DT_RECEB` vem do nome, o dicionário oficial não foi lido) | [pycvm 0.4.1 (PyPI)](https://pypi.org/project/pycvm/) | 13/10/2026 |
| O zip guarda só a **última versão** de cada documento ou todas as versões? | ❌ | — | — |
| Conta `3.01` da DRE: "Receita de Venda de Bens e/ou Serviços" (empresas em geral); "Receitas da Intermediação Financeira" (bancos); "Receitas das Operações" (seguradoras). | 🟡 (layouts do pycvm + DFPs publicadas pelas empresas) | [pycvm 0.4.1 (PyPI)](https://pypi.org/project/pycvm/), [Grazziotin — DFP 2023](https://www.grazziotin.com.br/wp-content/uploads/2025/04/grazziotin-dfp-2023.pdf) | 13/10/2026 |
| Lucro por ação: `3.99` "Lucro por Ação - (Reais / Ação)", `3.99.01` "Lucro Básico por Ação", `3.99.01.01` ON, `3.99.01.02` PN (há empresas com PNA/PNB no lugar de PN). O valor é em **reais por ação** mesmo quando a escala é MIL (ex.: Grazziotin 2023: receita 676.829 mil e LPA PN 4,7629). | 🟡 (DFPs e ITRs publicados pelas empresas, vistos pelo buscador) | [Cedro — ITR 2T24](https://cedro.com.br/wp-content/uploads/2024/08/ITR-CVM-2TRI24-ASSINADO.pdf), [Grazziotin — DFP 2023](https://www.grazziotin.com.br/wp-content/uploads/2025/04/grazziotin-dfp-2023.pdf), [Metisa — DFP 2022](https://www.metisa.com.br/wp-content/uploads/2023/03/DFP-2022.pdf) | 13/10/2026 |
| ITR (trimestral) existe no mesmo formato e com a mesma política de atualização. O Radar **não usa** o ITR (só exercícios anuais; ver ADR-0024). | 🟡 (trecho oficial) | [Conjunto ITR](https://dados.cvm.gov.br/dataset/cia_aberta-doc-itr) | 13/10/2026 |

### 6.3 Ticker da B3 → empresa (CNPJ)

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| O cadastro `cad_cia_aberta.csv` (Informação Cadastral) tem `CNPJ_CIA`, `DENOM_SOCIAL`, `CD_CVM`, `TP_MERC` e outros campos, mas **não encontramos coluna de código de negociação** (ticker) nele. | 🟡 (dicionário oficial visto pelo buscador; ausência do ticker não confirmada no arquivo) | [Dicionário do cadastro](https://dados.cvm.gov.br/dataset/cia_aberta-cad/resource/f51d2be3-f521-4b79-ac76-d8319c86c86c) | 13/10/2026 |
| O FCA (Formulário Cadastral) traz `fca_cia_aberta_valor_mobiliario_AAAA.csv` (seção 2 do anexo 22 da ICVM 480: valores mobiliários), em `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_AAAA.zip`, atualizado toda semana. | 🟡 (trecho oficial) 🔌 | [Conjunto FCA](https://dados.cvm.gov.br/dataset/cia_aberta-doc-fca) | 13/10/2026 |
| Colunas do `valor_mobiliario`: `CNPJ_Companhia`, `ID_Documento`, `Valor_Mobiliario` ("Ações Ordinárias", "Ações Preferenciais", "Units", …), `Classe_Acao_Preferencial` ("Preferencial Classe A", …), **`Codigo_Negociacao`** (o ticker), `Mercado`, `Data_Inicio_Negociacao`, `Data_Fim_Negociacao`, `Segmento`. | 🟡 (código do pycvm) | [pycvm 0.4.1 (PyPI)](https://pypi.org/project/pycvm/) | 13/10/2026 |
| Final do ticker: 3 = ordinária (ON), 4 = preferencial (PN), 5 = PNA, 6 = PNB; 11 = units (e também BDRs, ETFs e FIIs). | 🟡 (glossário da B3 visto pelo buscador) | [B3 Bora Investir — códigos das ações](https://borainvestir.b3.com.br/glossario/codigos-das-acoes/) | 13/10/2026 |

**Decisões (ADR-0024):** o mapa ticker → CNPJ vem do FCA da CVM (fonte oficial); não há tabela feita à mão.
Só exercícios anuais (10-K/20-F na SEC, DFP na CVM). A SEC é consultada a no máximo 5 requisições por
segundo (metade do limite) e só com `SEC_USER_AGENT` preenchido. Units, BDRs, ETFs e fundos ficam sem
fundamentos ("não verificado").

## 7. Juros — Banco Central (SGS)

| Fato                                                                                                                                                                                      | Selo | Fonte                                                                                                                                     | Data       |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Série **432** = Meta Selic definida pelo Copom (% a.a.).                                                                                                                                  | ✅   | [Dados abertos BCB — 432](https://dadosabertos.bcb.gov.br/dataset/432-taxa-de-juros---meta-selic-definida-pelo-copom)                     | 12/10/2026 |
| Série **12** = CDI diário (% ao dia), dias úteis, desde 1986.                                                                                                                             | 🟡   | [sgs2 (PyPI)](https://pypi.org/project/sgs2/), [brfinance (CRAN)](https://ftp.fau.de/cran/web/packages/brfinance/refman/brfinance.html)   | 12/10/2026 |
| Chamada real às séries 432 e 12 funcionou (últimos valores) e o painel Brasil mostrou o CDI ao ano calculado a partir delas. | ✅ (teste real) | [workflow "Dados reais"](https://github.com/Pingusto193/trade-view/actions/runs/39340445244) | 19/10/2026 |
| Série **4389** = CDI anualizado base 252.                                                                                                                                                 | ❌   | Não confirmado nesta sessão                                                                                                               | —          |
| Série **1178** = Selic anualizada base 252.                                                                                                                                               | ✅   | [Dados abertos BCB — 1178](https://dadosabertos.bcb.gov.br/dataset/1178-taxa-de-juros---selic-anualizada-base-252)                        | 12/10/2026 |
| Desde 26/03/2025, consultas JSON/CSV de séries diárias exigem filtro de datas e **cada consulta é limitada a 10 anos**.                                                                   | ✅   | Mesma página da série 1178                                                                                                                | 12/10/2026 |
| Endpoint: `https://api.bcb.gov.br/dados/serie/bcdata.sgs.{código}/dados?formato=json&dataInicial=DD/MM/AAAA&dataFinal=DD/MM/AAAA`; resposta `[{"data":"DD/MM/AAAA","valor":"0.055131"}]`. | 🟡   | [TabNews](https://www.tabnews.com.br/SidneyBissoli/series-do-banco-central-como-consultar-o-sgs-a-focus-e-a-ptax-sem-cair-nas-armadilhas) | 12/10/2026 |

**Decisão:** o benchmark usa a série 12 (CDI diário), acumulada dia a dia, e busca em janelas de no máximo 10 anos.

## 8. Contratos futuros da B3

| Fato                                                                                                                                                               | Selo | Fonte                                                                                                                                                                     | Data       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Mini-índice (WIN): R$ 0,20 por ponto; variação mínima de 5 pontos (R$ 1,00 por tick por contrato). Vencimento em meses pares, quarta-feira mais próxima do dia 15. | 🟡   | [B3 Bora Investir — glossário](https://borainvestir.b3.com.br/glossario/mini-indice/), blogs                                                                              | 12/10/2026 |
| Mini-dólar (WDO): US$ 10.000 por contrato; R$ 10,00 por ponto.                                                                                                     | 🟡   | [B3 Bora Investir — glossário](https://borainvestir.b3.com.br/glossario/mini-dolar/), [Toro](https://blog.toroinvestimentos.com.br/mini-dolar-o-que-e-como-funciona-wdo/) | 12/10/2026 |
| Tick do WDO = 0,5 ponto (R$ 5,00 por contrato); cotação em pontos = dólar × 1000. | 🟡 | [Nelogica — ticks](https://ajuda.nelogica.com.br/hc/pt-br/articles/4401991544987-O-que-s%C3%A3o-e-para-que-servem-os-ticks), [XP — minicontratos](https://conteudos.xpi.com.br/aprenda-a-investir/relatorios/minicontratos/), [Traders Brasil](https://traders.com.br/blog/posts/o-que-e-mini-dolar-wdo) (site da B3 inacessível daqui) | 13/10/2026 |
| Margens: variam por corretora.                                                                                                                                     | —    | Usuário deve informar                                                                                                                                                     | —          |

## 9. Impostos

| Fato                                                                                                                                                                                                                                           | Selo                                           | Fonte                                                                                                                                                                                                                                                                       | Data       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| MP 1.303/2025 caducou (retirada de pauta em 08/10/2025). Regras de 2026 para ações: swing 15%, day trade 20%, isenção de vendas até R$ 20 mil/mês só no swing de ações; limite é sobre **valor vendido**, não lucro.                           | 🟡 (portais, inclusive B3 Bora Investir)       | [B3 Bora Investir](https://borainvestir.b3.com.br/?p=59887), [Contábeis](https://www.contabeis.com.br/artigos/73399/a-queda-da-mp-1303-2025-o-que-muda-na-tributacao-de-investimentos-e-criptoativos/), [Lei 11.033/2004](https://www.legisweb.com.br/legislacao/?id=86267) | 12/10/2026 |
| IRRF 0,005% sobre vendas (swing) e 1% sobre o lucro (day trade), retido pela corretora e descontado do imposto devido; DARF 6015; prejuízo compensa só na mesma modalidade; vencimento no último dia útil do mês seguinte; isenção de R$ 20 mil é "tudo ou nada" sobre o total vendido de ações no mês. | 🟡 (corretoras e B3 Bora Investir; Receita não aberta) | [B3 Bora Investir — day trade](https://borainvestir.b3.com.br/tipos-de-investimentos/renda-variavel/day-trade/como-declarar-day-trade-no-imposto-de-renda-confira-com-o-bora/), [Rico](https://riconnect.rico.com.vc/?p=672791) | 12/10/2026 |
| DARF mínimo de R$ 10: abaixo disso não se recolhe; o valor é somado ao imposto de mesmo código dos meses seguintes até chegar a R$ 10 (Lei 9.430/1996, art. 68, § 1º, citada por fontes contábeis). | 🟡 (fontes secundárias; lei não aberta) | [Econet](https://blog.econeteditora.com.br/darf-inferior-10), [Jornal Contábil](https://jornalcontabil.com.br/noticia/dctfweb-o-que-fazer-quando-o-darf-nao-atinge-o-valor/) | 12/10/2026 |
| Cripto: regras **em disputa**. Fontes divergem sobre a isenção de R$ 35 mil/mês e sobre a Lei 14.754/2023 para exchanges estrangeiras. Menção a IN RFB 2.291/2026 (DeCripto) não confirmada no texto oficial. DARF 4600 para ganho de capital. | 🟡 contraditório                               | [brapi blog](https://brapi.dev/blog/como-declarar-criptomoedas-imposto-renda-2026), [Jornal Contábil](https://jornalcontabil.com.br/noticia/o-que-muda-para-as-criptomoedas-em-2026-com-a-reforma-tributaria/)                                                              | 12/10/2026 |

**Decisão:** regimes de cripto desligados por padrão, com aviso "consulte um contador" (SPEC §15).

## 10. Evidência citada na Biblioteca

| Fato                                                                                                                                                                                                                                                                                                                                             | Selo | Fonte                                                                                                                                                                | Data       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Chague, De-Losso e Giovannetti (2019), "Day trading for a living?": dos que começaram entre 2013 e 2015 e persistiram por pelo menos 300 dias, **97% perderam dinheiro**; só 0,4% ganharam mais que um caixa de banco (~US$ 54/dia); sem evidência de aprendizado. Mercado: **futuros de ações brasileiro** (o resumo não separa o mini-índice). | ✅   | [Repositório FGV](https://repositorio.fgv.br/items/e87d04fc-4b4c-4a56-ab5a-1c84c1afde1b/full), [IDEAS/RePEc](https://ideas.repec.org/p/spa/wpaper/2019wpecon47.html) | 12/10/2026 |

## 11. Hospedagem

Pesquisa refeita em 20/10/2026 para o guia `GUIA_ORACLE.md` (ADR-0031). Os sites da Oracle e do DuckDNS
estão bloqueados no ambiente de desenvolvimento: trechos do buscador = 🟡. Let's Encrypt, Caddy e
Docker lidos no código-fonte oficial dos sites no GitHub = ✅. **Correção:** a linha antiga ("A1 =
3.000 OCPU-h / 18.000 GB-h ≈ 4 OCPU / 24 GB") estava desatualizada.

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| Ampere A1 (VM.Standard.A1.Flex) Always Free: 1.500 OCPU-horas e 9.000 GB-horas por mês ≈ **2 OCPU e 12 GB** (antes 4/24; corte relatado em 15/06/2026). Memória mínima 1 GB por OCPU. | 🟡 | [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/) | 20/10/2026 |
| VM.Standard.E2.1.Micro (AMD): até 2 instâncias de 1/8 de OCPU e 1 GB de RAM cada. | 🟡 | [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | 20/10/2026 |
| Disco grátis: 200 GB no total (boot de ~50 GB conta); saída de rede grátis: 10 TB/mês. | 🟡 | [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | 20/10/2026 |
| Cadastro exige cartão de crédito (ou débito que funcione como crédito) no próprio nome; **não** aceita virtual, de uso único ou pré-pago; celular obrigatório; CPF no formulário brasileiro. Pré-autorização de US$ 1 (US$ 100 no upgrade para Pay As You Go), devolvida pelo banco em dias. | 🟡 | [FAQ Free Tier](https://www.oracle.com/br/cloud/free/faq/), [Cadastro (pt-BR)](https://docs.oracle.com/pt-br/iaas/Content/GSG/Tasks/signingup_topic-Sign_Up_for_Free_Oracle_Cloud_Promotion.htm), [Pagamento](https://docs.oracle.com/en-us/iaas/Content/Billing/Tasks/changingpaymentmethod.htm) | 20/10/2026 |
| A região home é escolhida no cadastro e **não pode ser trocada**; recursos Always Free só nela. Brasil: São Paulo (`sa-saopaulo-1`) e Vinhedo (`sa-vinhedo-1`), cada uma com 1 availability domain. | 🟡 | [Home Region](https://docs.oracle.com/en/cloud/foundation/cloud_architecture/governance/regions.html), [Regiões](https://docs.oracle.com/pt-br/iaas/Content/General/Concepts/regions.htm) | 20/10/2026 |
| "Out of host capacity" para formas Always Free é reconhecido pela Oracle e pode durar dias; há relato de São Paulo sem A1 por 3 dias. | 🟡 | [Out of Host Capacity](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/troubleshooting-out-of-host-capacity.htm), [relato SP](https://community.oracle.com/customerconnect/discussion/949983/cannot-upgrade-free-tier-to-payg-a1-flex-out-of-capacity-in-sa-saopaulo-1-for-3-days) | 20/10/2026 |
| **Instância ociosa pode ser parada pela Oracle** se, em 7 dias, TODAS forem verdade: CPU (percentil 95) < 20%, rede < 20% e — só na A1 — memória < 20%. A parada mantém discos e IP; religar depende de haver capacidade. Contas Pay As You Go isentas: só um e-mail de 2023 citado por usuários. | 🟡 | [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Customer Connect](https://community.oracle.com/customerconnect/discussion/671904/reclamation-of-idle-compute-instances) | 20/10/2026 |
| Conta sem uso por 30 (ou 60, as páginas divergem) dias pode ser suspensa. | 🟡 contraditório | [FAQ](https://www.oracle.com/cloud/free/faq/), [Promoção expirada](https://docs.oracle.com/en-us/iaas/Content/GSG/Tasks/signingup_topic-What_Happens_When_the_Promotion_Expires.htm) | 20/10/2026 |
| A Security List padrão libera só SSH (22) e ICMP; abrir 80 e 443 = regra de entrada stateful, origem `0.0.0.0/0`, TCP. Nas imagens Ubuntu da Oracle o iptables recusa tudo menos SSH: `iptables -I INPUT … --dport 80 -j ACCEPT` + `netfilter-persistent save`; **não usar UFW** (a Oracle avisa que pode impedir o boot). | 🟡 | [Security Rules](https://docs.oracle.com/en-us/iaas/Content/Network/Concepts/securityrules.htm), [Apache no Ubuntu](https://docs.oracle.com/en-us/iaas/Content/developer/apache-on-ubuntu/01oci-ubuntu-apache-summary.htm), [Boas práticas](https://docs.oracle.com/en-us/iaas/Content/Compute/References/bestpracticescompute.htm) | 20/10/2026 |
| Budgets da Oracle só avisam por e-mail (avaliados a cada 24 h); não bloqueiam gastos. | 🟡 | [Budgets](https://docs.oracle.com/en-us/iaas/Content/Billing/Concepts/budgetsoverview.htm) | 20/10/2026 |
| Docker Engine suporta Ubuntu 24.04 arm64; `get.docker.com` funciona em Ubuntu/Debian e **não** em Oracle Linux. | ✅ | [Docker no Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [docker-install](https://github.com/docker/docker-install) | 20/10/2026 |
| Portas publicadas pelo Docker passam pela tabela `nat`/`FORWARD`, não pela `INPUT` (ignoram UFW/firewalld). Só 80 e 443 são publicadas; o app (8787) fica na rede interna do Docker. | ✅ | [Docker — firewalls](https://docs.docker.com/engine/network/packet-filtering-firewalls/) | 20/10/2026 |
| DuckDNS: DNS gratuito `<nome>.duckdns.org` → IP; login por GitHub ou Google; atualização `https://www.duckdns.org/update?domains=<nome>&token=<token>&ip=` (sem `ip` = detecta sozinho). | 🟡 | [DuckDNS spec](https://www.duckdns.org/spec.jsp), [FAQ](https://www.duckdns.org/faqs.jsp) | 20/10/2026 |
| `duckdns.org` está na Public Suffix List: cada subdomínio conta como domínio próprio no Let's Encrypt. `sslip.io` e `nip.io` não estão (limite dividido com todos). | ✅ | [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) | 20/10/2026 |
| Let's Encrypt: 50 certificados por domínio registrado a cada 7 dias e **5 por conjunto idêntico de nomes a cada 7 dias** (apagar os dados do Caddy e reinstalar várias vezes esgota); HTTP-01 só na porta 80. | ✅ | [Rate limits](https://letsencrypt.org/docs/rate-limits/), [Challenge types](https://letsencrypt.org/docs/challenge-types/) | 20/10/2026 |
| Caddy emite HTTPS sozinho quando o DNS aponta para o servidor, as portas 80/443 estão abertas por fora e a pasta de dados é persistente (no Compose: volumes `caddy-data`/`caddy-config`). | ✅ | [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Caddy no Compose](https://caddyserver.com/docs/running#docker-compose) | 20/10/2026 |

### 11.1 Servidor sempre ligado — comparação (26/10/2026)

Notícias e previsões exigem servidor ligado 24 h (SPEC §23). Pesquisa por busca (sites dos provedores
bloqueados aqui): tudo 🟡; "(terceiros)" = só blogs/agregadores. Reais estimados com US$ 1 = R$ 5,50 (dólar
de 26/10/2026, dia de alta forte) e IOF de 3,5% em compra internacional no cartão (🟡, Decreto 12.499/2025).

| Opção | Preço/mês | Hiberna? | Região | Observações | Selo | Fonte | Data |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Oracle Always Free (conta grátis) | R$ 0 | Não hiberna, mas pode **parar** VM ociosa (§11) | São Paulo | risco de parada e de mudança de regras | 🟡 | [Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) | 26/10/2026 |
| Oracle Pay As You Go mantendo Always Free | US$ 0 dentro dos limites; pré-autorização US$ 100 | parada por ociosidade "só para Always Free" (e-mail citado em fórum) | São Paulo | acima do limite paga; orçamento só avisa | 🟡 | [Upgrade](https://docs.oracle.com/en-us/iaas/Content/Billing/Tasks/changingpaymentmethod.htm), [fórum](https://community.oracle.com/customerconnect/discussion/671904/reclamation-of-idle-compute-instances) | 26/10/2026 |
| Locaweb VPS 1 GB (2 vCPU, 40 GB) | R$ 29,90 no mensal (R$ 15,90 com 24 meses) | Não | Brasil | em reais, sem IOF; IPv4 dedicado e Docker **não confirmados** | 🟡 | [VPS](https://www.locaweb.com.br/servidor-vps/) | 26/10/2026 |
| Magalu Cloud BV1-1-10 (1 vCPU, 1 GB, 10 GB) | R$ 34,99 com impostos | Não | São Paulo | Pix/boleto; R$ 100 de crédito ao validar cartão; IP grátis "por enquanto" | 🟡 | [Preços](https://magalu.cloud/precos/virtual-machines/) | 26/10/2026 |
| AWS Lightsail 1 GB | US$ 7 (≈ R$ 44 com impostos, faturado em reais com CPF) | Não | São Paulo (desde 06/2026) | sem IOF, aceita Pix; preço específico de SP não confirmado | 🟡 | [Planos](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), [SP](https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-lightsail-aws-regions/) | 26/10/2026 |
| Vultr 1 GB São Paulo | ≈ US$ 7,50 | Não | São Paulo | preço de SP só por terceiros | 🟡 (terceiros) | [Vultr](https://www.vultr.com/pricing/) | 26/10/2026 |
| Hetzner CX23/CAX11 | €5,99–6,49 com IPv4 | Não | Alemanha/Finlândia | **sem estoque para novos clientes** desde 06/2026 | 🟡 | [Status](https://status.hetzner.com/incident/0a75c7ae-3377-41dc-aabe-601063724d24) | 26/10/2026 |
| Render grátis / Koyeb grátis | US$ 0 | **Sim** (15 min / 1 h) e sem disco persistente | — | não servem | 🟡 | [Render](https://render.com/docs/free), [Koyeb](https://www.koyeb.com/pricing) | 26/10/2026 |
| Fly.io | ≈ US$ 6 em SP com volume | **auto-stop ligado por padrão** (precisa desligar) | São Paulo | sem plano grátis | 🟡 | [Autostop](https://fly.io/docs/launch/autostop-autostart/) | 26/10/2026 |

Binance: lista de 2023 (fórum) de países bloqueados inclui EUA, Canadá e Holanda; se o
`data-api.binance.vision` bloqueia por país não foi confirmado (❌). Servidor no Brasil é o mais seguro.

## 13. Notificações (Fase 4)

Nesta sessão `webkit.org` e `core.telegram.org` não abriram diretamente (DNS bloqueado no ambiente); os fatos vieram pelo buscador, que mostrou trechos das páginas oficiais. Por isso o selo máximo é 🟡 até alguém abrir as páginas.

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| iPhone/iPad: Web Push só para web app **adicionado à Tela de Início**, iOS/iPadOS **16.4+**, com permissão pedida **em resposta a um toque do usuário**; não aparece numa aba comum do Safari. Usa Push API + Notifications API + Service Worker (padrões web, chaves VAPID). | 🟡 (trecho oficial visto pelo buscador) | [WebKit — Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [OneSignal — iOS web push](https://documentation.onesignal.com/docs/ios-web-push) | 12/10/2026 |
| Telegram: bots não passam de ~**30 mensagens/s** no total sem "paid broadcasts". | 🟡 (FAQ oficial visto pelo buscador) | [Telegram Bots FAQ](https://core.telegram.org/bots/faq) | 12/10/2026 |
| Telegram: evitar mais de **1 mensagem/s no mesmo chat**; ~20/min em grupos. Telegram não documenta os limites com precisão; excesso devolve **429** com `retry_after` (segundos). | 🟡 (fontes secundárias) | [grammY — flood limits](https://grammy.dev/advanced/flood), [python-telegram-bot wiki](https://github.com/python-telegram-bot/python-telegram-bot/wiki/Avoiding-flood-limits) | 12/10/2026 |
| Telegram `sendMessage`: `chat_id` + `text` (1 a 4096 caracteres após processar entidades); chamada `https://api.telegram.org/bot<token>/sendMessage`. O bot só fala com quem iniciou conversa com ele (por isso o guia pede para mandar /start). | 🟡 (documentação de bibliotecas) | [aiogram — send_message](https://aiogram.readthedocs.io/en/v3.1.1/api/methods/send_message.html) | 12/10/2026 |

**Decisões:** o Radar manda no máximo 1 mensagem por segundo por chat do Telegram, respeita `retry_after` e corta o texto em 4.000 caracteres; no iPhone, a tela guiada só mostra o botão "Ativar notificações" quando o app está aberto pela Tela de Início.

## 14. Custos usados no Modo Treino (padrões editáveis por conta)

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| B3, ações, pessoa física: emolumentos ≈ 0,030% do volume no swing (negociação 0,005% + liquidação 0,025%); day trade ≈ 0,023% até R$ 1 milhão/dia. Fontes divergem (há quem cite 0,039%). Tabela oficial de ações à vista não aberta. | 🟡 (corretoras; divergente) | [Toro](https://blog.toroinvestimentos.com.br/bolsa/emolumentos/), [Funds Explorer](https://www.fundsexplorer.com.br/artigos/emolumentos/), [B3 — tarifas](https://www.b3.com.br/pt_br/produtos-e-servicos/tarifas/listados-a-vista-e-derivativos/renda-variavel/tarifas-de-acoes-e-fundos-de-investimento/opcoes-de-acoes/) | 12/10/2026 |
| Binance (global), spot, usuário comum: taxa base ≈ 0,1% por execução (desconto com BNB e por volume). Binance.US tem tabela diferente. | 🟡 (fontes secundárias; página oficial não aberta) | [Cointelegraph](https://cointelegraph.com/news/binance-us-cuts-spot-trading-fees-to-near-zero-in-push-to-undercut-rivals), [Binance.US](https://blog.binance.us/zero-fee-trading/) | 12/10/2026 |
| Corretagem de ações no Brasil: muitas corretoras cobram zero, outras não; ações dos EUA dependem da corretora internacional escolhida. | ❌ (varia; o usuário informa) | — | — |

**Decisões (padrões do Treino):** B3 = 0,03% + 1 tick de derrapagem; cripto = 0,1% + spread de 0,02%;
EUA = 1 tick de derrapagem, sem taxa; forex = 2 ticks + spread de 0,02%. Todos editáveis na conta de
treino. Spread de cripto e derrapagens são **decisão nossa**, não medidos.

## 12. Bibliotecas (npm, consultado direto no registro em 12/10/2026)

| Pacote                       | Versão         | Licença          | Observação                                                                                                                                                                           |
| ---------------------------- | -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| lightweight-charts           | 5.2.1          | Apache-2.0       | Desenhos só via plugins/primitives ([doc v5](https://www.tradingview.com/blog/en/tradingview-lightweight-charts-version-5-50837)). Aviso de atribuição ao TradingView: ver ADR-0003. |
| klinecharts                  | 10.0.3         | Apache-2.0       | Desenhos (overlays) e indicadores nativos.                                                                                                                                           |
| typescript                   | 6.0.3 (fixado) | Apache-2.0       | 7.0.2 existe, mas o typescript-eslint 8.71 exige `<6.1.0`. Ver ADR-0002.                                                                                                             |
| react / react-dom            | 19.3.0         | MIT              |                                                                                                                                                                                      |
| vite                         | 8.x            | MIT              |                                                                                                                                                                                      |
| tailwindcss                  | 4.x            | MIT              |                                                                                                                                                                                      |
| fastify                      | 5.x            | MIT              |                                                                                                                                                                                      |
| drizzle-orm / better-sqlite3 | 0.45 / 13      | Apache-2.0 / MIT |                                                                                                                                                                                      |
| fast-xml-parser | 5.11.2 (fixado, publicado em 29/09/2026) | MIT | Leitor de RSS/Atom das notícias (ADR-0032). DOCTYPE removido antes de ler (sem expansão de entidades). Consultado no registro em 26/10/2026. |
| zod                          | 4.x            | MIT              |                                                                                                                                                                                      |
| vitest                       | 5.x            | MIT              |                                                                                                                                                                                      |
| web-push                     | 3.6.7          | **MPL-2.0**      | Licença copyleft fraca por arquivo; uso como dependência é permitido. Última versão de 2024.                                                                                         |
| nodemailer                   | 10.0.14        | MIT-0            | Envio por SMTP para os alertas por e-mail; traz os próprios tipos. Versões saem quase toda semana: fixada para evitar surpresa.                                                       |

## 15. Fatos usados no app ainda SEM fonte registrada (a verificar)

Levantados na revisão da Biblioteca (13/10/2026). Enquanto não forem conferidos, o app e as páginas os tratam
como suposição, nunca como fato.

| Fato                                                                                                   | Selo | Onde aparece                                              | Próximo passo                                                  |
| ------------------------------------------------------------------------------------------------------ | ---- | --------------------------------------------------------- | -------------------------------------------------------------- |
| Volume da brapi (ações da B3) cobre o mercado inteiro ("volume completo")                              | ❌   | adaptador brapi (`volume: 'complete'`), página Volume     | Conferir na documentação da brapi; se não confirmar, rebaixar  |
| Lote padrão de 100 ações e mercado fracionário (1 a 99) na B3                                          | ❌   | adaptador brapi (`lotSize: 100`), calculadora, Biblioteca | Conferir na B3 (regra de lote) e registrar com link            |
| Brasília em UTC−3 o ano todo (sem horário de verão)                                                    | 🟡   | página VWAP (texto evita afirmar); agente MT5 (fuso da B3) | O [Decreto 9.772/2019](https://planalto.gov.br/ccivil_03/_ato2019-2022/2019/decreto/d9772.htm) encerrou o horário de verão (visto pelo buscador em 13/10/2026); o UTC−3 vem da base de fusos (IANA `America/Sao_Paulo`) |
| Barras intradiárias da Alpaca (IEX) incluem ou não pré e pós-mercado                                   | ❌   | VWAP intradiária das ações dos EUA                        | Conferir na documentação da Alpaca                             |
| Candle ao vivo das ações dos EUA com volume só da IEX × histórico com volume consolidado               | 🟡   | filtro de volume da consolidação (ao vivo × laboratório)  | Medir a diferença com dados reais; avisar na tela se relevante |
| Lista sugerida de 20 ações da B3 dos experimentos (composição e liquidez atuais)                       | 🟡   | `packages/shared/src/experiments.ts`, ADR-0017            | Conferir com a carteira teórica do Ibovespa da data            |

## 16. MetaTrader 5 — agente `agents/mt5-bridge` (B3 em tempo real e forex)

Nesta sessão `mql5.com` e `metatrader5.com` **não abriram diretamente** (DNS bloqueado no ambiente). O PyPI
abriu: o pacote oficial foi baixado (`pip download MetaTrader5==5.0.6231`) e o `__init__.py` e o
`METADATA` foram lidos; nomes de funções e campos foram conferidos nas strings do módulo binário `_core`.
Nenhuma chamada a um terminal MT5 real foi feita daqui (o pacote só roda no Windows).

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| Pacote oficial `MetaTrader5` (MetaQuotes), versão **5.0.6231** de 27/09/2026, licença **MIT**, `Requires-Python >=3.6,<4` (classificadores 3.6 a 3.14), depende de `numpy>=1.7`. Só há arquivos para **Windows x86-64** (nenhum para Linux/macOS). | ✅ (PyPI + METADATA do pacote) | [PyPI — MetaTrader5](https://pypi.org/project/MetaTrader5/) | 13/10/2026 |
| Assinaturas no módulo oficial: `initialize([path],[server],[login],[password])`, `shutdown()`, `last_error()`, `terminal_info()`, `symbol_info(symbol)`, `symbol_select(symbol,[enable])`, `symbol_info_tick(symbol)`, `copy_rates_from_pos(symbol, timeframe, start_pos, count)`. | ✅ (lido no pacote oficial) | Pacote 5.0.6231; [doc oficial](https://www.mql5.com/en/docs/integration/python_metatrader5) não aberta | 13/10/2026 |
| O mesmo pacote também **envia ordens** (`order_send`, `order_check`, `Buy`, `Sell`, `Close`) e lê a conta (`account_info`, `positions_get`, `history_deals_get`). O agente do Radar **não usa nenhuma dessas** (um teste automático procura esses nomes no código do agente). | ✅ (lido no pacote) | Pacote 5.0.6231 (`__init__.py`) | 13/10/2026 |
| Constantes de escala: `TIMEFRAME_M1=1`, `M5=5`, `M15=15`, `M30=30`, `H1=1\|0x4000`, `D1=24\|0x4000`, `W1=1\|0x8000`, `MN1=1\|0xC000`. Códigos de `last_error()`: `RES_S_OK=1`, `RES_E_FAIL=-1`, `RES_E_NOT_FOUND=-4`, `RES_E_AUTH_FAILED=-6`, `RES_E_INTERNAL_FAIL_CONNECT=-10004` etc. | ✅ | Pacote 5.0.6231 (`__init__.py`) | 13/10/2026 |
| `trade_calc_mode`: `FOREX=0`, `FUTURES=1`, `CFD=2`, `CFDINDEX=3`, `CFDLEVERAGE=4`, `FOREX_NO_LEVERAGE=5`, `EXCH_STOCKS=32`, `EXCH_FUTURES=33`, `EXCH_OPTIONS=34`, `EXCH_OPTIONS_MARGIN=36`, `EXCH_BONDS=37`. | ✅ | Pacote 5.0.6231 (`__init__.py`) | 13/10/2026 |
| Campos existentes: barra = `time, open, high, low, close, tick_volume, spread, real_volume`; tick = `time, bid, ask, last, volume, time_msc, flags, volume_real`; símbolo = `name, description, path, exchange, currency_base, currency_profit, digits, point, trade_tick_size, trade_tick_value, trade_contract_size, volume_min, volume_step, trade_calc_mode`; terminal = `company, connected`. Na posição 0 de `copy_rates_from_pos` fica a barra mais recente (em formação); o vetor volta da mais antiga para a mais nova. | 🟡 (nomes vistos no binário oficial; significado e ordem por fontes secundárias) | Pacote 5.0.6231; [guia de terceiros](https://mcp-metatrader5-server.readthedocs.io/en/latest/market_data_guide/) | 13/10/2026 |
| `initialize()` sem login e senha se conecta ao terminal **já aberto e logado** (não precisa da senha da corretora). | 🟡 (guias e fórum; doc oficial não aberta) | [Fórum MQL5](https://www.mql5.com/en/forum/393357/29246235), [guia](https://codemia.io/knowledge-hub/path/initializing_metatrader_in_python) | 13/10/2026 |
| **Horário das barras:** a doc oficial diz que o MT5 guarda os horários em UTC, mas relatos no fórum MQL5 mostram valores no **relógio do servidor da corretora** (ex.: UTC+3), iguais aos do MQL5 (`TimeCurrent`). Não existe função que informe o fuso do servidor nem o histórico de mudanças dele. | 🟡 **contraditório** | [Fórum 517653](https://www.mql5.com/en/forum/517653), [Fórum 515951](https://www.mql5.com/en/forum/515951), [Fórum 516958](https://www.mql5.com/en/forum/516958) | 13/10/2026 |
| A opção "Máx. barras no gráfico" (Ferramentas → Opções → Gráficos) limita quantas barras o terminal entrega pelas funções de cópia. | 🟡 (biblioteca de terceiros + relato no fórum) | [bbstrader](https://bbstrader.readthedocs.io/en/latest/_modules/bbstrader/metatrader/rates.html), [Fórum MQL5 (ru)](https://www.mql5.com/ru/forum/121010/3201042) | 13/10/2026 |
| **Tick volume** = número de mudanças de preço (ticks) no intervalo, **não** a quantidade negociada; em ações e bolsa, volume é o dos negócios executados. | 🟡 (trecho da ajuda oficial visto pelo buscador) | [Ajuda MT5 — indicadores de volume](https://www.metatrader5.com/en/terminal/help/indicators/volume_indicators), [blog MQL5](https://www.mql5.com/en/blogs/post/774938) | 13/10/2026 |
| No forex o `real_volume` costuma vir **zero** (balcão, sem volume central); o `last` do tick também é 0. | 🟡 (fontes de terceiros e fórum) | [Trading Wyckoff](https://tradingwyckoff.com/en/tick-volume-vs-real-volume/), [Fórum MQL5](https://www.mql5.com/en/forum/18935/743520) | 13/10/2026 |
| Fuso do servidor MT5 das corretoras da B3 (horário de Brasília?) e das de forex (muitas usariam UTC+2/UTC+3, "fechamento de Nova York"). | ❌ | Não encontrado; o agente detecta pelo tick e aceita configuração | — |
| Nomes dos ativos variam por corretora (contínuos do mini-índice e mini-dólar como `WIN$N`/`WDO$N`, sufixos como `EURUSD.a`). | ❌ | O guia manda copiar o nome da "Observação de Mercado" | — |
| Se os dados da B3 no MT5 da corretora são em tempo real e se há cobrança. | ❌ (varia por corretora) | Perguntar à corretora | — |
| Horário de negociação do mini-índice e do mini-dólar (usamos 09:00–18:30 como janela larga). | ❌ | Conferir na B3 | — |
| Python no Windows (instalador do python.org): a opção de colocar o Python no PATH vem **desligada** por padrão; o "py launcher" vem ligado. | 🟡 (docs.python.org 3.10/3.11 via buscador) | [Using Python on Windows](https://docs.python.org/3.10/using/windows.html) | 13/10/2026 |
| Windows: atalho na pasta aberta por `Win + R` → `shell:startup` abre o programa ao entrar no Windows. | 🟡 (sites de terceiros) | [Computer Hope](https://www.computerhope.com/issues/ch001606.htm) | 13/10/2026 |

**Decisões (ADR-0023):** o agente manda os horários **crus** do MT5 e o fuso que configurou/detectou; o
servidor converte para UTC (ADR-0006). Escalas lidas do MT5: M1, M5, M15, M30, H1 e D1 (o semanal e o
mensal são montados a partir do diário, com a semana começando na segunda). Volume: forex = tick volume;
B3 = `real_volume` quando a corretora manda, senão tick volume (com aviso).

## 17. Assistente com IA — API da Anthropic (Fase 9, opcional)

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| Preços por milhão de tokens (US$): Claude Opus 5.5 entrada 4 / saída 20 (leitura de cache 0,20); Claude Sonnet 5.5 2 / 10; Claude Haiku 5.5 0,10 / 0,50 (até 100 mil tokens no pedido). | ✅ (página oficial lida) | [Anthropic — Pricing](https://platform.claude.com/docs/en/about-claude/pricing) | 14/10/2026 |
| Modelo atual da linha Opus: `claude-opus-5-5` (pensamento sempre ligado; profundidade pelo `effort`, padrão `medium`). A lista de modelos vigentes vem do endpoint `GET /v1/models`. | 🟡 (referência do SDK oficial, cache de 06/10/2026) | [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview) | 14/10/2026 |
| Recusa por segurança volta como `stop_reason: "refusal"`; o parâmetro `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) refaz o pedido em outro modelo na mesma chamada (Opus 5.5, Opus 5, Sonnet 5.5, Fable 5.1). | 🟡 (referência do SDK oficial) | [Refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback) | 14/10/2026 |
| O ambiente de desenvolvimento alcança `api.anthropic.com` (HTTP 401 sem chave, como esperado). Nenhuma chamada com chave foi feita (custa dinheiro do usuário). | 🔌 (conexão ok; uso com chave pendente) | — | 19/10/2026 |

**Decisões:** o nome do modelo e os preços NÃO ficam fixos no código: vêm do `.env` (`ASSISTANT_MODEL`, `ASSISTANT_PRICE_IN`, `ASSISTANT_PRICE_OUT`) e podem ser mudados na tela; a lista de modelos é buscada na API com a chave do usuário. O custo mostrado é estimativa pelos preços configurados (com reserva para outro modelo, o preço real pode diferir um pouco).

## 18. Testes com dados reais (workflow "Dados reais" no GitHub)

O ambiente de desenvolvimento bloqueia as fontes (403 do proxy), mas os servidores do GitHub Actions
têm internet. O workflow `.github/workflows/live.yml` roda `pnpm test:live` e um E2E com o servidor sem
simulador (`apps/web/e2e-live`). Roda ao mudar esses testes, por pedido manual (Actions › Dados reais ›
Run workflow) e toda segunda às 09:13 de Brasília. Primeira rodada completa: [workflow "Dados reais"](https://github.com/Pingusto193/trade-view/actions/runs/39340445244), 19/10/2026.

| Fonte | Resultado em 19/10/2026 |
| ----- | ----------------------- |
| Binance (REST e WebSocket, `binance.vision`) | ✅ 10 candles diários, metadados, candle de 1m ao vivo; no app, BTC no 1m atualiza sozinho (desktop e 375 px) |
| Banco Central (SGS 432 e 12) | ✅ valores reais; painel Brasil mostra o CDI real |
| brapi (PETR4 sem token) | ✅ 5 candles diários |
| B3 COTAHIST diário | ✅ arquivo de 16/10/2026; campos conferidos contra a brapi e pelo preço médio |
| CVM (FCA + DFP) | ✅ PETR4 com fundamentos calculados |
| SEC EDGAR | 🔌 pulado: falta o segredo `SEC_USER_AGENT` |
| Alpaca | 🔌 pulado: faltam `ALPACA_KEY_ID` e `ALPACA_SECRET_KEY` |
| MetaTrader 5 | 🔌 precisa do MT5 aberto num Windows (fora do alcance do GitHub) |
| Anthropic (assistente) | 🔌 de propósito fora: cada chamada custa dinheiro da conta do usuário |

## 19. Notícias e calendário (SPEC §23.1, ADR-0032) — pesquisa de 26/10/2026

Os sites estão bloqueados no ambiente de desenvolvimento: tudo veio de trechos do buscador nos domínios
oficiais (🟡) ou de código de terceiros; **nenhum feed foi baixado daqui** (🔌). O workflow "Dados reais"
baixa cada fonte ligada e registra formato e atraso reais (§18). Regra do projeto: o Radar guarda título,
link, horário e trecho curto do feed; o resumo por IA usa **só título + trecho do feed** (nunca baixa a
matéria) e só nas fontes marcadas como permitidas.

| Fonte | Endereço | Termos | Resumo IA | Selo | Fonte | Data |
| --- | --- | --- | --- | --- | --- | --- |
| SEC EDGAR 8-K (Atom) | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&company=&owner=include&start=0&count=40&output=atom`; `updated` = hora de aceitação com fuso; aparece 1–3 min após a aceitação; exige User-Agent com e-mail, 10 req/s | "public information … may be copied or further distributed … without the SEC's permission" | permitido | 🟡 🔌 | [Webmaster FAQ](https://www.sec.gov/about/webmaster-frequently-asked-questions), [Privacy](https://www.sec.gov/about/privacy-information), [edgartools](https://pypi.org/project/edgartools/) | 26/10/2026 |
| Banco Central — notas à imprensa (RSS) | `https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/notasImprensa` (URL vinda do Feeder; a página oficial de RSS existe mas não mostra as URLs) | dados abertos (ODbL) | permitido | 🟡 🔌 | [RSS BCB](https://www.bcb.gov.br/en/about/rssen), [Feeder](https://feeder.co/discover/d1cb7ec4c4/bcb-gov-br) | 26/10/2026 |
| Banco Central — Copom (JSON) | `https://www.bcb.gov.br/api/servico/sitebcb/copom/comunicados?quantidade=5` e `…/copom/atas?quantidade=N` | ODbL | permitido | 🟡 🔌 (formato não lido) | [Dados abertos Copom](https://dadosabertos.bcb.gov.br/dataset/atas-comunicados-copom) | 26/10/2026 |
| Federal Reserve (RSS) | página `https://www.federalreserve.gov/feeds/` ("All Press Releases", "Monetary Policy"); arquivo `press_monetary.xml` **não confirmado** | domínio público, citar o Board | permitido | 🟡 / ❌ nome do arquivo | [Feeds](https://federalreserve.gov/feeds), [Disclaimer](https://federalreserve.gov/disclaimer.htm) | 26/10/2026 |
| BLS (RSS) | `https://www.bls.gov/feed/empsit.rss` (payroll), `https://www.bls.gov/feed/cpi.rss` (CPI); relatos de 403 sem User-Agent com e-mail | domínio público, com crédito | permitido | 🟡 🔌 | [BLS feeds](https://www.bls.gov/feed/), [Copyright](https://www.bls.gov/opub/copyright-information.htm) | 26/10/2026 |
| Agência Brasil — Economia (RSS) | `https://agenciabrasil.ebc.com.br/rss/economia/feed.xml` | conteúdo próprio reproduzível com indicação da fonte; **conteúdo de agências internacionais é proibido** | permitido só para conteúdo próprio | 🟡 🔌 | [Feeds](https://agenciabrasil.ebc.com.br/feed/), [Sobre](https://agenciabrasil.ebc.com.br/sobre) | 26/10/2026 |
| Nasdaq — Markets (RSS) | `https://www.nasdaq.com/feed/rssoutbound?category=Markets` | a página diz que os títulos podem ser exibidos no próprio site | **proibido** (só título + link) | 🟡 | [Nasdaq RSS](https://nasdaq.com/services/rss.aspx) | 26/10/2026 |
| IBGE — calendário e releases (JSON) | `https://servicodados.ibge.gov.br/api/v3/calendario` e `…/api/v3/noticias`; formato das datas contraditório | reprodução com citação | permitido | 🟡 🔌 | [API IBGE](https://servicodados.ibge.gov.br/api/docs/) | 26/10/2026 |
| BLS — calendário (iCalendar) | `https://www.bls.gov/schedule/news_release/bls.ics`, horários em ET | domínio público | — | 🟡 🔌 | [Agenda BLS](https://www.bls.gov/schedule/news_release/cpi.htm) | 26/10/2026 |
| CVM IPE (fatos relevantes) | `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/ipe_cia_aberta_AAAA.zip`; atualização **semanal** → atraso de até ~1 semana: serve para histórico (estudo de evento), não para alerta; colunas não lidas | ODbL | permitido | 🟡 🔌 / ❌ colunas | [Conjunto IPE](https://dados.cvm.gov.br/dataset/cia_aberta-doc-ipe) | 26/10/2026 |
| Atraso entre publicar e aparecer no feed (veículos) | nenhum veículo documenta | — | — | ❌ | — | 26/10/2026 |

**Evitadas (termos ou bloqueio):**

| Fonte | Motivo | Selo | Fonte | Data |
| --- | --- | --- | --- | --- |
| Investing.com | termos proíbem "employing any automated system … to extract data or content … for any purpose" | 🟡 | [Terms](https://cdn.investing.com/about-us/terms_and_conditions.html) | 26/10/2026 |
| Yahoo Finance (RSS por ticker) | termos proíbem coleta automática sem permissão | 🟡 | [Yahoo ToS](https://legal.yahoo.com/xw/en/yahoo/terms/otos/index.html) | 26/10/2026 |
| FRED | termos proíbem armazenar/cachear e uso para IA | 🟡 | [API Terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html) | 26/10/2026 |
| Reuters | sem RSS público desde 2020; bloqueia robôs de IA | 🟡 / ✅ bloqueio observado | [Feeder](https://feeder.co/knowledge-base/rss-content/reuters-rss-feeds/) | 26/10/2026 |
| G1, Valor (Globo), Folha (UOL), Estadão, MarketWatch | bloqueiam robôs de IA (busca do Claude recusada nesses domínios); Globo veda uso em IA generativa | ✅ bloqueio observado / 🟡 política | [InfoMoney sobre bloqueios](https://www.infomoney.com.br/business/o-que-significam-os-bloqueios-de-jornais-aos-treinamentos-de-ia-generativa/) | 26/10/2026 |
| Exame, Money Times, Poder360 | termos proíbem coleta automática/reprodução sem autorização | 🟡 | [Exame](https://exame.com/institucional/termos-de-uso/), [Money Times](https://www.moneytimes.com.br/termos-de-uso/), [Poder360](https://www.poder360.com.br/reproducao-de-material/) | 26/10/2026 |
| InfoMoney, CNBC | termos não encontrados (desconhecido ≠ permitido) | ❌ | — | 26/10/2026 |
| B3 (Plantão de empresas, BDI, RAD/ENET) | sem API/feed público; seria scraping | ❌ | — | 26/10/2026 |

**Calendário (datas oficiais copiadas para arquivo de configuração, sem API):**

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| Copom: reuniões restantes de 2026 em 03–04/11 e 08–09/12; 2027: 26–27/01, 16–17/03, 27–28/04, 15–16/06, 03–04/08, 21–22/09, 26–27/10, 07–08/12; comunicado ~18h30 do 2º dia | 🟡 | [BCB Copom](https://www.bcb.gov.br/en/monetarypolicy/committee) | 26/10/2026 |
| FOMC 2026: 27–28/10, 08–09/12; 2027: 26–27/01, 16–17/03, 27–28/04, 08–09/06, 27–28/07, 14–15/09, 26–27/10, 07–08/12; decisão às 14h ET do 2º dia | 🟡 | [FOMC calendars](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm) | 26/10/2026 |

## 20. Mini-índice (WIN) e mini-dólar (WDO)

| Fato | Selo | Fonte | Data |
| --- | --- | --- | --- |
| Não existe fonte grátis, permitida e automática de candles **intradiários** de WIN/WDO; o caminho grátis é o agente MT5 com a conta da corretora (§16) | 🟡 (busca extensa) | — | 26/10/2026 |
| Termos da B3 em páginas de market data: "vedada a coleta automatizada, inclusive por meio de ferramentas de inteligência artificial, para quaisquer finalidades, comerciais ou não" — **pode atingir o download automático do COTAHIST** (ADR-0009); precisa de leitura completa ou consulta à B3 | 🟡 | [Índices B3](https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/cotacoes/indices.htm), [Termos](https://www.b3.com.br/pt_br/termos-de-uso-e-protecao-de-dados/termos-de-uso/) | 26/10/2026 |
| brapi futuros (fim de pregão, ~1 ano, contrato completo como `WINZ26`): incluído no plano **Pro, R$ 139,99/mês**; se funciona sem token é contraditório | 🟡 contraditório | [Blog futuros](https://brapi.dev/blog/api-contratos-futuros-b3-cotacao-historico-curva), [Pricing](https://brapi.dev/pricing) | 26/10/2026 |
| Substitutos rotulados: Ibovespa `^BVSP` pela brapi (~30 min de atraso, 3 meses de diário) ou BOVA11; USD/BRL pela Twelve Data (§5.1) | 🟡 | [brapi IBOV](https://brapi.dev/faq/buscar-ibov) | 26/10/2026 |

