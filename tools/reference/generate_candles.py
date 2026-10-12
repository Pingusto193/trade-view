"""
Gera uma série de candles SINTÉTICA e determinística para testar indicadores.

ATENÇÃO: estes candles NÃO são dados de mercado. Servem apenas como entrada para comparar a
implementação TypeScript (packages/core) com a implementação de referência em pandas.

Inclui casos de borda de propósito:
- um trecho "parado" (máxima = mínima = fechamento) para testar divisões por zero (ADX, Estocástico);
- gaps de abertura (para o True Range);
- tendência de alta, de baixa e lateralidade.

Uso:  python3 tools/reference/generate_candles.py
Saída: packages/core/test/reference/candles.json
"""

import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "packages" / "core" / "test" / "reference" / "candles.json"

N = 600
DAY_MS = 86_400_000
START = 1_577_836_800_000  # 2020-01-01T00:00:00Z


def main() -> None:
    rng = np.random.default_rng(20261012)
    drift = np.concatenate(
        [
            np.full(200, 0.0015),  # alta
            np.full(150, -0.0020),  # baixa
            np.full(250, 0.0),  # lateral
        ]
    )
    rets = drift + rng.normal(0, 0.018, N)
    closes = 100 * np.exp(np.cumsum(rets))

    candles = []
    prev_close = 100.0
    for i in range(N):
        close = float(closes[i])
        # gap de abertura ocasional
        gap = rng.normal(0, 0.004) + (0.03 if i in (120, 380) else 0.0) - (0.04 if i == 260 else 0.0)
        open_ = prev_close * (1 + gap)
        hi = max(open_, close) * (1 + abs(rng.normal(0, 0.006)))
        lo = min(open_, close) * (1 - abs(rng.normal(0, 0.006)))
        vol = float(round(abs(rng.normal(1_000_000, 250_000)) * (2.5 if i % 37 == 0 else 1.0)))
        if 450 <= i < 465:  # trecho parado
            open_ = hi = lo = close = round(prev_close, 2)
            vol = 0.0
        candles.append(
            {
                "time": START + i * DAY_MS,
                "open": round(open_, 4),
                "high": round(hi, 4),
                "low": round(lo, 4),
                "close": round(close, 4),
                "volume": vol,
            }
        )
        prev_close = candles[-1]["close"]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"_aviso": "SINTÉTICO — não são dados de mercado", "candles": candles}, indent=1))
    print(f"{len(candles)} candles → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
