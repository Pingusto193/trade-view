"""Dublês para os testes: um pacote MetaTrader5 falso e um cliente do Radar falso."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List, Optional


class FakeMT5:
    """Imita só as funções de leitura do pacote oficial. Qualquer função de ordem explode."""

    TIMEFRAME_M1 = 1
    TIMEFRAME_M5 = 5
    TIMEFRAME_M15 = 15
    TIMEFRAME_M30 = 30
    TIMEFRAME_H1 = 1 | 0x4000
    TIMEFRAME_D1 = 24 | 0x4000

    def __init__(self, symbols: Optional[Dict[str, Dict[str, Any]]] = None, init_ok: bool = True):
        self.calls: List[str] = []
        self.symbols = symbols if symbols is not None else {"EURUSD": EURUSD_INFO}
        self.init_ok = init_ok
        self.connected = True
        self.rates: Dict[Any, Any] = {}
        self.tick = SimpleNamespace(time=1_700_000_000 + 7200, time_msc=1_700_007_200_000)

    def _c(self, name: str) -> None:
        self.calls.append(name)

    def initialize(self, *args: Any, **kw: Any) -> bool:
        self._c("initialize")
        assert "password" not in kw and "login" not in kw, "o agente nunca passa login/senha"
        return self.init_ok

    def shutdown(self) -> None:
        self._c("shutdown")

    def last_error(self) -> Any:
        self._c("last_error")
        return (-10004, "No IPC connection")

    def terminal_info(self) -> Any:
        self._c("terminal_info")
        return SimpleNamespace(connected=self.connected, company="Corretora Falsa S.A.")

    def symbol_select(self, name: str, enable: bool = True) -> bool:
        self._c("symbol_select")
        return name in self.symbols

    def symbol_info(self, name: str) -> Any:
        self._c("symbol_info")
        d = self.symbols.get(name)
        return SimpleNamespace(**d) if d else None

    def symbol_info_tick(self, name: str) -> Any:
        self._c("symbol_info_tick")
        return self.tick

    def copy_rates_from_pos(self, name: str, tf: int, start: int, count: int) -> Any:
        self._c("copy_rates_from_pos")
        self.last_rates_call = (name, tf, start, count)
        return self.rates.get((name, tf))

    # funções que o agente NUNCA pode chamar
    def order_send(self, *a: Any, **k: Any) -> None:  # pragma: no cover
        raise AssertionError("o agente tentou enviar uma ordem!")

    def account_info(self, *a: Any, **k: Any) -> None:  # pragma: no cover
        raise AssertionError("o agente tentou ler a conta!")


EURUSD_INFO: Dict[str, Any] = {
    "name": "EURUSD",
    "description": "Euro vs US Dollar",
    "path": "Forex\\Majors\\EURUSD",
    "exchange": "",
    "currency_base": "EUR",
    "currency_profit": "USD",
    "digits": 5,
    "point": 0.00001,
    "trade_tick_size": 0.00001,
    "trade_tick_value": 1.0,
    "trade_contract_size": 100000.0,
    "volume_min": 0.01,
    "volume_step": 0.01,
    "trade_calc_mode": 0,
    # campos que existem no MT5 e o agente ignora
    "bid": 1.1,
    "session_deals": 0,
}


class FakeClient:
    """Guarda os envios e devolve respostas programadas."""

    def __init__(self, responses: Optional[List[Any]] = None) -> None:
        self.sent: List[Dict[str, Any]] = []
        self.responses = list(responses or [])

    def post(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        self.sent.append(payload)
        r = self.responses.pop(0) if self.responses else None
        if isinstance(r, Exception):
            raise r
        return r or {"ok": True, "serverTime": 0, "wants": [], "history": [], "messages": []}
