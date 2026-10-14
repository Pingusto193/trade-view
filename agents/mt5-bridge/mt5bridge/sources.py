"""De onde vêm as barras: o MetaTrader 5 de verdade ou o simulador (DADOS SIMULADOS).

Só funções de LEITURA do pacote oficial `MetaTrader5` são usadas (DATA_SOURCES §16):
initialize, shutdown, last_error, terminal_info, symbol_select, symbol_info, symbol_info_tick e
copy_rates_from_pos. Um teste automático garante que nenhuma função de ordem ou de conta aparece aqui.

Barras "cruas" (como o MT5 entrega): [time (s, relógio do servidor da corretora), open, high, low,
close, tick_volume, spread, real_volume], da mais antiga para a mais nova.
"""

from __future__ import annotations

import math
import random
import time
import zlib
from collections import Counter, OrderedDict
from typing import Any, Callable, Dict, List, Optional, Tuple

TIMEFRAMES = ("1m", "5m", "15m", "30m", "60m", "1d")
TF_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "60m": 60, "1d": 1440}
MAX_BARS = 10_000

Rate = List[float]

INFO_FIELDS = (
    ("name", ""),
    ("description", ""),
    ("path", ""),
    ("exchange", ""),
    ("currency_base", ""),
    ("currency_profit", ""),
    ("digits", 0),
    ("point", 0.0),
    ("trade_tick_size", 0.0),
    ("trade_tick_value", 0.0),
    ("trade_contract_size", 0.0),
    ("volume_min", 0.0),
    ("volume_step", 0.0),
    ("trade_calc_mode", -1),
)


class SourceError(Exception):
    """Problema ao ler o MetaTrader 5 (mensagem pronta para o usuário)."""


class MissingPackageError(SourceError):
    """O pacote oficial MetaTrader5 não está instalado."""


# ---------------------------------------------------------------------------------------- MT5 real


def _row(r: Any) -> Rate:
    """Converte uma linha do MT5 (registro do numpy, dict ou tupla) em lista de números."""
    try:
        vals = (
            r["time"],
            r["open"],
            r["high"],
            r["low"],
            r["close"],
            r["tick_volume"],
            r["spread"],
            r["real_volume"],
        )
    except (TypeError, IndexError, KeyError, ValueError):
        vals = tuple(r)[:8]
    t, o, h, lo, c, tv, sp, rv = vals
    return [int(t), float(o), float(h), float(lo), float(c), float(tv), float(sp), float(rv)]


class MetaTraderSource:
    """Lê o terminal MetaTrader 5 aberto e logado neste PC (só Windows)."""

    mode = "mt5"

    def __init__(self, terminal_path: str = "", module: Any = None) -> None:
        self.terminal_path = terminal_path
        self._mt5 = module
        self._connected = False

    def _module(self) -> Any:
        if self._mt5 is None:
            try:
                import MetaTrader5  # type: ignore  # só existe no Windows

                self._mt5 = MetaTrader5
            except ImportError:
                raise MissingPackageError(
                    "o pacote MetaTrader5 não está instalado. No Prompt de Comando, rode: "
                    "py -m pip install MetaTrader5"
                ) from None
        return self._mt5

    def _error(self) -> str:
        try:
            return str(self._module().last_error())
        except Exception:
            return "erro desconhecido"

    def connect(self) -> None:
        mt5 = self._module()
        # Sem login/senha: conecta ao terminal já aberto e logado (a senha nunca passa pelo agente).
        ok = mt5.initialize(self.terminal_path) if self.terminal_path else mt5.initialize()
        if not ok:
            raise SourceError(
                f"não consegui conectar ao MetaTrader 5 ({self._error()}). O MT5 está aberto e "
                "logado na corretora?"
            )
        self._connected = True

    def close(self) -> None:
        if self._connected and self._mt5 is not None:
            try:
                self._mt5.shutdown()
            except Exception:
                pass
        self._connected = False

    def _tf(self, tf: str) -> int:
        mt5 = self._module()
        names = {
            "1m": ("TIMEFRAME_M1", 1),
            "5m": ("TIMEFRAME_M5", 5),
            "15m": ("TIMEFRAME_M15", 15),
            "30m": ("TIMEFRAME_M30", 30),
            "60m": ("TIMEFRAME_H1", 1 | 0x4000),
            "1d": ("TIMEFRAME_D1", 24 | 0x4000),
        }
        name, fallback = names[tf]
        return int(getattr(mt5, name, fallback))

    def status(self) -> Dict[str, Any]:
        info = self._module().terminal_info()
        if info is None:
            raise SourceError(f"o MetaTrader 5 não respondeu ({self._error()}); ele foi fechado?")
        return {
            "terminalConnected": bool(getattr(info, "connected", False)),
            "company": str(getattr(info, "company", "") or ""),
        }

    def symbol_info(self, name: str) -> Optional[Dict[str, Any]]:
        mt5 = self._module()
        # symbol_select só coloca o ativo na Observação de Mercado (necessário para ler as barras)
        if not mt5.symbol_select(name, True):
            return None
        si = mt5.symbol_info(name)
        if si is None:
            return None
        out: Dict[str, Any] = {}
        for f, default in INFO_FIELDS:
            v = getattr(si, f, default)
            out[f] = type(default)(v) if v is not None else default
        out["name"] = name
        out["description"] = out["description"][:200]
        out["path"] = out["path"][:200]
        out["exchange"] = out["exchange"][:60]
        return out

    def rates(self, name: str, tf: str, count: int) -> List[Rate]:
        mt5 = self._module()
        arr = mt5.copy_rates_from_pos(name, self._tf(tf), 0, max(1, min(int(count), MAX_BARS)))
        if arr is None:
            raise SourceError(f"o MT5 não entregou barras de {name} ({tf}): {self._error()}")
        return [_row(r) for r in arr]

    def last_tick(self, name: str) -> Optional[Tuple[int, int]]:
        t = self._module().symbol_info_tick(name)
        if t is None:
            return None
        return int(getattr(t, "time", 0)), int(getattr(t, "time_msc", 0))


# ---------------------------------------------------------------------------------------- simulador

# nome → (descrição, preço-base, dígitos, tick, valor do tick, contrato, lote mín., passo,
#         modo de cálculo, moeda-base, moeda de lucro, volatilidade diária, tem volume real?)
SIM_SPECS: Dict[str, Tuple[Any, ...]] = {
    "EURUSD": ("Euro x Dólar", 1.08, 5, 0.00001, 1.0, 100000.0, 0.01, 0.01, 0, "EUR", "USD", 0.005, False),
    "GBPUSD": ("Libra x Dólar", 1.27, 5, 0.00001, 1.0, 100000.0, 0.01, 0.01, 0, "GBP", "USD", 0.006, False),
    "USDJPY": ("Dólar x Iene", 150.0, 3, 0.001, 0.67, 100000.0, 0.01, 0.01, 0, "USD", "JPY", 0.006, False),
    "WIN$N": ("Mini Índice (contínuo)", 130000.0, 0, 5.0, 1.0, 1.0, 1.0, 1.0, 33, "", "BRL", 0.012, True),
    "WDO$N": ("Mini Dólar (contínuo)", 5500.0, 1, 0.5, 5.0, 1.0, 1.0, 1.0, 33, "", "BRL", 0.008, True),
    "PETR4": ("Petrobras PN", 38.0, 2, 0.01, 0.01, 1.0, 100.0, 100.0, 32, "", "BRL", 0.018, True),
}
_EPOCH_DAY = 7305  # 01/01/1990 (dias desde 1970): cobre 10 mil candles diários


def _seed(*parts: Any) -> int:
    return zlib.crc32(":".join(str(p) for p in parts).encode("utf-8"))


class SimulatedSource:
    """DADOS SIMULADOS para testar a ponte sem MetaTrader 5: passeio aleatório determinístico.

    Funciona 24 h por dia, 7 dias por semana, com o "relógio do servidor" em UTC. O servidor do Radar
    só aceita estes dados em desenvolvimento (RADAR_SIMULATED=1) e os mostra com a faixa
    "DADOS SIMULADOS" — nunca passam por dados reais.
    """

    mode = "simulated"

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.clock = clock
        self._closes: Dict[str, List[float]] = {}
        self._days: "OrderedDict[Tuple[str, int], Tuple[List[float], List[float]]]" = OrderedDict()

    def connect(self) -> None:
        pass

    def close(self) -> None:
        pass

    def status(self) -> Dict[str, Any]:
        return {"terminalConnected": True, "company": "Simulador do agente Radar (DADOS SIMULADOS)"}

    def _spec(self, name: str) -> Tuple[Any, ...]:
        if name in SIM_SPECS:
            return SIM_SPECS[name]
        return (f"Ativo simulado {name}", 100.0, 2, 0.01, 0.01, 1.0, 1.0, 1.0, 0, "", "USD", 0.01, False)

    def symbol_info(self, name: str) -> Optional[Dict[str, Any]]:
        s = self._spec(name)
        return {
            "name": name,
            "description": f"{s[0]} (SIMULADO)",
            "path": "Simulador\\" + name,
            "exchange": "",
            "currency_base": s[9],
            "currency_profit": s[10],
            "digits": s[2],
            "point": s[3],
            "trade_tick_size": s[3],
            "trade_tick_value": s[4],
            "trade_contract_size": s[5],
            "volume_min": s[6],
            "volume_step": s[7],
            "trade_calc_mode": s[8],
        }

    # --- preço: fechamento diário em passeio aleatório; dentro do dia, ponte browniana até ele

    def _day_close_log(self, name: str, day: int) -> float:
        base = math.log(self._spec(name)[1])
        sigma = self._spec(name)[11]
        i = max(0, day - _EPOCH_DAY)
        w = self._closes.setdefault(name, [0.0])
        while len(w) <= i:
            j = len(w)
            g = random.Random(_seed(name, "d", _EPOCH_DAY + j)).gauss(0.0, 1.0)
            w.append(w[-1] + sigma * g - 0.002 * w[-1])  # leve volta à média
        return base + w[i]

    def _day_path(self, name: str, day: int) -> Tuple[List[float], List[float]]:
        """1441 pontos (log do preço a cada minuto) + ruído de máxima/mínima por minuto."""
        key = (name, day)
        hit = self._days.get(key)
        if hit is not None:
            self._days.move_to_end(key)
            return hit
        r = random.Random(_seed(name, "m", day))
        sigma_min = self._spec(name)[11] / math.sqrt(1440)
        walk = [0.0]
        for _ in range(1440):
            walk.append(walk[-1] + sigma_min * r.gauss(0.0, 1.0))
        a = self._day_close_log(name, day - 1)
        b = self._day_close_log(name, day)
        drift = walk[-1] - (b - a)
        path = [a + walk[i] - drift * i / 1440 for i in range(1441)]
        wick = [abs(r.gauss(0.0, 1.0)) * sigma_min * 0.6 for _ in range(1440)]
        self._days[key] = (path, wick)
        while len(self._days) > 120:
            self._days.popitem(last=False)
        return path, wick

    def _price_at(self, name: str, t: float) -> float:
        day = int(t // 86400)
        path, _ = self._day_path(name, day)
        x = (t - day * 86400) / 60.0
        i = min(int(x), 1439)
        f = x - i
        return math.exp(path[i] + (path[i + 1] - path[i]) * f)

    def _round(self, name: str, p: float) -> float:
        tick = self._spec(name)[3]
        return round(round(p / tick) * tick, int(self._spec(name)[2]))

    def _minute_bar(self, name: str, m: int, now: float) -> Rate:
        """Barra de 1 min que começa no minuto `m` (desde 1970); a do minuto atual vai até `now`."""
        day = m // 1440
        i = m % 1440
        path, wick = self._day_path(name, day)
        o = math.exp(path[i])
        end = (m + 1) * 60
        frac = 1.0 if now >= end else max(0.0, (now - m * 60) / 60.0)
        c = math.exp(path[i] + (path[i + 1] - path[i]) * frac) if frac < 1 else math.exp(path[i + 1])
        h = max(o, c) * math.exp(wick[i] * frac)
        lo = min(o, c) * math.exp(-wick[(i + 7) % 1440] * frac)
        ticks = int((20 + (_seed(name, "v", m) % 80)) * max(frac, 0.05))
        real = ticks * 7 if self._spec(name)[12] else 0
        o, h, lo, c = (self._round(name, x) for x in (o, h, lo, c))
        h = max(h, o, c)
        lo = min(lo, o, c)
        return [m * 60, o, h, lo, c, float(ticks), 1.0, float(real)]

    def _daily_bar(self, name: str, day: int, now: float) -> Rate:
        today = int(now // 86400)
        o = math.exp(self._day_close_log(name, day - 1))
        if day >= today - 10:
            # últimos dias: extremos pelo caminho minuto a minuto (bate com o intradiário)
            path, _ = self._day_path(name, day)
            n = 1440 if day < today else max(1, min(1440, int((now - day * 86400) // 60) + 1))
            pts = [math.exp(x) for x in path[: n + 1]]
            c = self._price_at(name, now) if day == today else math.exp(path[1440])
            h, lo = max(pts + [c]), min(pts + [c])
        else:
            r = random.Random(_seed(name, "D", day))
            c = math.exp(self._day_close_log(name, day))
            sig = self._spec(name)[11]
            h = max(o, c) * math.exp(abs(r.gauss(0.0, 1.0)) * sig * 0.5)
            lo = min(o, c) * math.exp(-abs(r.gauss(0.0, 1.0)) * sig * 0.5)
        ticks = 20000 + _seed(name, "V", day) % 30000
        real = ticks * 7 if self._spec(name)[12] else 0
        o, h, lo, c = (self._round(name, x) for x in (o, h, lo, c))
        return [day * 86400, o, max(h, o, c), min(lo, o, c), c, float(ticks), 1.0, float(real)]

    def rates(self, name: str, tf: str, count: int) -> List[Rate]:
        if tf not in TF_MINUTES:
            raise SourceError(f"escala desconhecida: {tf}")
        now = self.clock()
        count = max(1, min(int(count), MAX_BARS))
        if tf == "1d":
            today = int(now // 86400)
            return [self._daily_bar(name, d, now) for d in range(today - count + 1, today + 1)]
        size = TF_MINUTES[tf]
        cur = int(now // 60)
        first_bucket = (cur // size - count + 1) * size
        out: List[Rate] = []
        for b in range(first_bucket, cur + 1, size):
            bars = [self._minute_bar(name, m, now) for m in range(b, min(b + size, cur + 1))]
            out.append(
                [
                    b * 60,
                    bars[0][1],
                    max(x[2] for x in bars),
                    min(x[3] for x in bars),
                    bars[-1][4],
                    sum(x[5] for x in bars),
                    1.0,
                    sum(x[7] for x in bars),
                ]
            )
        return out

    def last_tick(self, name: str) -> Optional[Tuple[int, int]]:
        now = self.clock()
        return int(now), int(now * 1000)


# ---------------------------------------------------------------------------------------- fuso


class OffsetDetector:
    """Mede a diferença entre o relógio do servidor da corretora e o UTC do PC.

    Só usa ticks NOVOS (o horário do último tick mudou desde a consulta anterior): com o mercado
    parado o último tick é antigo e a conta daria errado. Arredonda para 30 min, o que tolera um
    relógio do PC alguns minutos errado. Precisa de 3 medidas iguais na maioria das últimas 20.
    """

    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.clock = clock
        self._last: Dict[str, int] = {}
        self._samples: List[int] = []

    def observe(self, symbol: str, tick_time_s: int, tick_msc: int) -> None:
        prev = self._last.get(symbol)
        self._last[symbol] = tick_msc
        if prev is None or tick_msc == prev or tick_time_s <= 0:
            return
        off = int(round((tick_time_s - self.clock()) / 1800.0)) * 30
        if -720 <= off <= 840:
            self._samples.append(off)
            del self._samples[:-20]

    @property
    def value(self) -> Optional[int]:
        if len(self._samples) < 3:
            return None
        off, n = Counter(self._samples).most_common(1)[0]
        return off if n >= 3 else None
