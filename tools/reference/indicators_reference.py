"""
Implementação de REFERÊNCIA dos indicadores do Radar, escrita de forma independente em pandas.

Objetivo (SPEC §19): conferir a implementação TypeScript de packages/core contra cálculos feitos
por outro caminho. Onde possível usamos as operações vetorizadas do pandas (rolling, ewm), e não
laços equivalentes ao código TypeScript, para que um erro de lógica não se repita nos dois lados.

Convenções (iguais às documentadas em docs/DECISIONS.md, ADR-0008):
- MMA: média aritmética simples de n valores.
- MME: alfa = 2/(n+1), semente = MMA dos n primeiros valores.
- Média de Wilder (RMA): alfa = 1/n, semente = MMA dos n primeiros valores.
- Desvio-padrão populacional (ddof = 0).
- True Range do 1º candle = máxima − mínima.
- ATR = RMA(TR).
- DMI/ADX: +DM, −DM e TR a partir do 2º candle; RMA com semente; ADX = RMA(DX).
- Stop ATR: ATR com MME(20) e regra de trailing com virada por fechamento.

Uso:  python3 tools/reference/indicators_reference.py
Lê:   packages/core/test/reference/candles.json
Gera: packages/core/test/reference/expected.json
"""

import json
import math
import pathlib

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[2]
REF = ROOT / "packages" / "core" / "test" / "reference"


def seeded_ewm(x: pd.Series, n: int, alpha: float) -> pd.Series:
    """Média exponencial com semente pela média dos n primeiros valores válidos."""
    valid = x.dropna()
    out = pd.Series(np.nan, index=x.index)
    if len(valid) < n:
        return out
    seed_idx = valid.index[n - 1]
    seeded = x.copy()
    seeded.loc[: seed_idx] = np.nan
    seeded.loc[seed_idx] = valid.iloc[:n].mean()
    # adjust=False: y_t = (1 − alfa) y_{t−1} + alfa x_t, começando no primeiro valor não nulo.
    res = seeded.ewm(alpha=alpha, adjust=False, ignore_na=True).mean()
    res.loc[: seed_idx] = np.nan
    res.loc[seed_idx] = valid.iloc[:n].mean()
    return res


def ema(x: pd.Series, n: int) -> pd.Series:
    return seeded_ewm(x, n, 2 / (n + 1))


def rma(x: pd.Series, n: int) -> pd.Series:
    return seeded_ewm(x, n, 1 / n)


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    tr = pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    tr.iloc[0] = df["high"].iloc[0] - df["low"].iloc[0]
    return tr


def dmi(df: pd.DataFrame, n: int):
    up = df["high"].diff()
    down = -df["low"].diff()
    plus_dm = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=df.index)
    minus_dm = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=df.index)
    plus_dm.iloc[0] = np.nan
    minus_dm.iloc[0] = np.nan
    tr = true_range(df)
    tr.iloc[0] = np.nan  # no DMI o TR também começa no 2º candle
    tr_s = rma(tr, n)
    plus_s = rma(plus_dm, n)
    minus_s = rma(minus_dm, n)
    plus_di = (100 * plus_s / tr_s).where(tr_s != 0, 0.0).where(tr_s.notna())
    minus_di = (100 * minus_s / tr_s).where(tr_s != 0, 0.0).where(tr_s.notna())
    total = plus_di + minus_di
    dx = (100 * (plus_di - minus_di).abs() / total).where(total != 0, 0.0).where(total.notna())
    adx = rma(dx, n)
    return plus_di, minus_di, adx


def stop_atr(df: pd.DataFrame, n: int, mult: float):
    a = ema(true_range(df), n)
    stops, dirs = [], []
    stop, d = math.nan, 0
    for close, atr_v in zip(df["close"], a):
        if math.isnan(atr_v):
            stops.append(math.nan)
            dirs.append(0)
            continue
        off = mult * atr_v
        if d == 0:
            d, stop = 1, close - off
        elif d == 1:
            if close < stop:
                d, stop = -1, close + off
            else:
                stop = max(stop, close - off)
        else:
            if close > stop:
                d, stop = 1, close - off
            else:
                stop = min(stop, close + off)
        stops.append(stop)
        dirs.append(d)
    return pd.Series(stops, index=df.index), pd.Series(dirs, index=df.index)


def rsi(close: pd.Series, n: int) -> pd.Series:
    ch = close.diff()
    gain = rma(ch.clip(lower=0), n)
    loss = rma((-ch).clip(lower=0), n)
    out = 100 - 100 / (1 + gain / loss)
    out = out.where(loss != 0, np.where(gain == 0, 50.0, 100.0))
    return out.where(gain.notna())


def stochastic(df: pd.DataFrame, n: int, k_smooth: int, d_period: int):
    hh = df["high"].rolling(n).max()
    ll = df["low"].rolling(n).min()
    raw = (100 * (df["close"] - ll) / (hh - ll)).where(hh != ll, 50.0).where(hh.notna())
    k = raw.rolling(k_smooth).mean()
    d = k.rolling(d_period).mean()
    return k, d


def vwap_daily(df: pd.DataFrame) -> pd.Series:
    key = df["time"] // 86_400_000
    typical = (df["high"] + df["low"] + df["close"]) / 3
    pv = (typical * df["volume"]).groupby(key).cumsum()
    vol = df["volume"].groupby(key).cumsum()
    return (pv / vol).where(vol != 0)


def to_list(s: pd.Series):
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else float(v) for v in s]


def main() -> None:
    data = json.loads((REF / "candles.json").read_text())
    df = pd.DataFrame(data["candles"])
    close = df["close"]

    bb_mid = close.rolling(20).mean()
    bb_sd = close.rolling(20).std(ddof=0)
    plus_di, minus_di, adx = dmi(df, 14)
    stop, direction = stop_atr(df, 20, 3)
    macd_line = ema(close, 12) - ema(close, 26)
    macd_signal = ema(macd_line, 9)
    st_k, st_d = stochastic(df, 14, 3, 3)

    expected = {
        "_aviso": "Gerado por tools/reference/indicators_reference.py a partir de candles SINTÉTICOS",
        "sma50": to_list(close.rolling(50).mean()),
        "sma200": to_list(close.rolling(200).mean()),
        "ema9": to_list(ema(close, 9)),
        "ema21": to_list(ema(close, 21)),
        "volumeSma21": to_list(df["volume"].rolling(21).mean()),
        "bb20_3_upper": to_list(bb_mid + 3 * bb_sd),
        "bb20_3_middle": to_list(bb_mid),
        "bb20_3_lower": to_list(bb_mid - 3 * bb_sd),
        "tr": to_list(true_range(df)),
        "atr14": to_list(rma(true_range(df), 14)),
        "atrEma20": to_list(ema(true_range(df), 20)),
        "plusDI14": to_list(plus_di),
        "minusDI14": to_list(minus_di),
        "adx14": to_list(adx),
        "stopAtr20x3": to_list(stop),
        "stopAtr20x3Dir": [int(x) for x in direction],
        "macd": to_list(macd_line),
        "macdSignal": to_list(macd_signal),
        "rsi14": to_list(rsi(close, 14)),
        "stochK": to_list(st_k),
        "stochD": to_list(st_d),
        "vwapDaily": to_list(vwap_daily(df)),
    }
    (REF / "expected.json").write_text(json.dumps(expected))
    print(f"referência gerada para {len(df)} candles → {(REF / 'expected.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
