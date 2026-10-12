# Fixtures de fontes de dados

**Todos os arquivos desta pasta são SINTÉTICOS**: foram escritos à mão no formato documentado de
cada API, porque o ambiente de desenvolvimento não tinha acesso à internet (ver
`docs/DATA_SOURCES.md`). Os preços **não são dados de mercado reais**.

Servem apenas para testar a leitura (parsing), a paginação e a lógica de tempo real dos adaptadores.
Os testes reais, contra as APIs, ficam em `test/live.test.ts` e só rodam com `RADAR_LIVE_TESTS=1`.

| Arquivo | Formato imitado | Status do formato |
|---|---|---|
| `binance-klines.json` | `GET /api/v3/klines` | 🟡 conhecido, não conferido nesta sessão |
| `binance-exchangeinfo.json` | `GET /api/v3/exchangeInfo?symbol=` | 🟡 |
| `binance-ws-kline.json` | evento `kline` do WebSocket | 🟡 |
| `alpaca-bars-page1.json`, `alpaca-bars-page2.json` | `GET /v2/stocks/{sym}/bars` | 🟡 |
| `brapi-quote-history.json`, `brapi-quote-live.json` | `GET /api/quote/{ticker}` | 🟡 |
| `bcb-sgs-12.json` | `GET /dados/serie/bcdata.sgs.12/dados` | 🟡 |
