"""O ciclo do agente: lê o que o Radar pediu, manda as barras e reconecta sozinho."""

from __future__ import annotations

import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from . import PROTOCOL, VERSION
from .client import AuthError, BadRequestError, ClientError, NetworkError, RadarClient, RefusedError
from .config import Config
from .sources import MAX_BARS, TIMEFRAMES, MissingPackageError, OffsetDetector, SourceError

Log = Callable[[str], None]

SYMBOLS_EVERY_S = 300  # reanuncia os ativos a cada 5 min (e após reconectar)
STATUS_EVERY_S = 60  # linha de "está funcionando" no console
MAX_HISTORY_PER_CYCLE = 3
MAX_HISTORY_BARS_PER_CYCLE = 20_000  # mantém cada envio bem abaixo do limite do servidor
NOT_FOUND = (
    "não existe nesta corretora ou não pôde ser ativado: confira o nome exato na Observação de "
    "Mercado do MT5"
)


def default_log(msg: str) -> None:
    print(f"{time.strftime('%d/%m/%Y %H:%M:%S')}  {msg}", flush=True)


def fmt_offset(minutes: Optional[int]) -> str:
    if minutes is None:
        return "ainda não medido (precisa de ticks chegando)"
    if minutes == 0:
        return "UTC"
    sign = "+" if minutes > 0 else "-"
    h, m = divmod(abs(minutes), 60)
    return f"UTC{sign}{h}" + (f":{m:02d}" if m else "")


class Agent:
    def __init__(
        self,
        cfg: Config,
        source: Any,
        client: RadarClient,
        log: Log = default_log,
        clock: Callable[[], float] = time.time,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.cfg = cfg
        self.source = source
        self.client = client
        self.log = log
        self.clock = clock
        self.sleep = sleep
        self.detector = OffsetDetector(clock)
        self.wants: Set[Tuple[str, str]] = set()
        self.history: Dict[Tuple[str, str], int] = {}
        self.errors: Dict[str, str] = {}
        self.infos: Dict[str, Dict[str, Any]] = {}
        self.symbols_sent_at: Optional[float] = None
        self.connected = False
        self.cycles = 0
        self._seen_messages: Set[str] = set()
        self._bars_since_status = 0
        self._last_status_log = clock()

    # ------------------------------------------------------------------ envio

    def _agent_block(self, terminal_connected: bool, company: str) -> Dict[str, Any]:
        block: Dict[str, Any] = {
            "version": VERSION,
            "mode": self.source.mode,
            "terminalConnected": terminal_connected,
            "serverTz": self.cfg.server_timezone,
            "detectedOffsetMin": self.detector.value,
        }
        if company:
            block["company"] = company[:120]
        return block

    def build_payload(self) -> Dict[str, Any]:
        now = self.clock()
        st = self.source.status()
        ok: Set[str] = set()
        payload: Dict[str, Any] = {"protocol": PROTOCOL}

        if self.symbols_sent_at is None or now - self.symbols_sent_at >= SYMBOLS_EVERY_S:
            infos: List[Dict[str, Any]] = []
            for name in self.cfg.symbols:
                try:
                    info = self.source.symbol_info(name)
                except SourceError as e:
                    self.errors[name] = str(e)
                    continue
                if info is None:
                    self.errors[name] = NOT_FOUND
                    self.infos.pop(name, None)
                    continue
                info = dict(info, market=self.cfg.market_for(name))
                self.infos[name] = info
                infos.append(info)
                ok.add(name)
            payload["symbols"] = infos

        bars: List[Dict[str, Any]] = []
        budget = MAX_HISTORY_BARS_PER_CYCLE
        for key, count in list(self.history.items()):
            if len(bars) >= MAX_HISTORY_PER_CYCLE or budget <= 0:
                break
            sym, tf = key
            del self.history[key]  # o Radar pede de novo se este envio se perder
            if sym not in self.infos:
                continue
            try:
                rates = self.source.rates(sym, tf, min(count, MAX_BARS))
            except SourceError as e:
                self.errors[sym] = str(e)
                continue
            bars.append({"symbol": sym, "tf": tf, "rates": rates, "history": True})
            budget -= len(rates)
            ok.add(sym)
        for sym, tf in sorted(self.wants):
            if sym not in self.infos:
                continue
            try:
                rates = self.source.rates(sym, tf, 3)
            except SourceError as e:
                self.errors[sym] = str(e)
                continue
            bars.append({"symbol": sym, "tf": tf, "rates": rates})
            ok.add(sym)
        for sym in ok:  # deu certo de novo: o problema saiu da lista
            self.errors.pop(sym, None)

        # fuso do servidor: compara ticks novos com o relógio do PC (no início e depois de vez em quando)
        if self.cycles < 60 or self.cycles % 30 == 0:
            for sym in list(self.infos)[:20]:
                try:
                    t = self.source.last_tick(sym)
                except SourceError:
                    t = None
                if t:
                    self.detector.observe(sym, t[0], t[1])

        payload["agent"] = self._agent_block(bool(st.get("terminalConnected")), st.get("company", ""))
        payload["bars"] = bars
        payload["errors"] = [
            ({"symbol": s, "message": m[:300]} if s else {"message": m[:300]})
            for s, m in list(self.errors.items())[:50]
        ]
        return payload

    def apply(self, resp: Dict[str, Any]) -> None:
        tfs = set(TIMEFRAMES)
        self.wants = {
            (str(w.get("symbol")), str(w.get("tf")))
            for w in resp.get("wants", [])
            if w.get("tf") in tfs and w.get("symbol")
        }
        for h in resp.get("history", []):
            if h.get("tf") not in tfs or not h.get("symbol"):
                continue
            key = (str(h["symbol"]), str(h["tf"]))
            self.history[key] = max(self.history.get(key, 0), int(h.get("count", 0) or 0))
        for m in resp.get("messages", []):
            if m not in self._seen_messages:
                self._seen_messages.add(m)
                self.log(f"Radar: {m}")

    def cycle(self) -> Dict[str, Any]:
        payload = self.build_payload()
        resp = self.client.post(payload)
        if "symbols" in payload:
            self.symbols_sent_at = self.clock()
        self.apply(resp)
        self.cycles += 1
        self._bars_since_status += sum(len(b["rates"]) for b in payload["bars"])
        self._status_line()
        return resp

    def _status_line(self) -> None:
        now = self.clock()
        if now - self._last_status_log < STATUS_EVERY_S:
            return
        self._last_status_log = now
        follow = ", ".join(f"{s} {tf}" for s, tf in sorted(self.wants)) or "nada aberto no Radar agora"
        problems = f" Problemas: {len(self.errors)} (veja no Radar)." if self.errors else ""
        self.log(
            f"Funcionando: {len(self.infos)} ativo(s) anunciados; acompanhando: {follow}; "
            f"{self._bars_since_status} barra(s) enviadas no último minuto; fuso do servidor: "
            f"{fmt_offset(self.detector.value)}.{problems}"
        )
        self._bars_since_status = 0

    def _heartbeat(self, problem: str) -> None:
        """MT5 fechado: avisa o Radar (o gráfico mostra o motivo) sem mandar dados."""
        payload = {
            "protocol": PROTOCOL,
            "agent": self._agent_block(False, ""),
            "bars": [],
            "errors": [{"message": problem[:300]}],
        }
        try:
            self.apply(self.client.post(payload))
        except ClientError:
            pass

    # ------------------------------------------------------------------ laço principal

    def run(self, max_cycles: Optional[int] = None, duration: Optional[float] = None) -> int:
        """Roda até Ctrl+C (ou até `max_cycles` tentativas / `duration` segundos). Devolve o código de saída."""
        start = self.clock()
        attempts = 0
        backoff = 1.0
        mode = "SIMULADOR (DADOS SIMULADOS)" if self.source.mode == "simulated" else "MetaTrader 5"
        self.log(f"Agente MT5 do Radar {VERSION} — {mode}. Enviando para {self.cfg.url}.")
        self.log("Só leitura: o agente nunca envia ordens. Para parar, feche esta janela ou aperte Ctrl+C.")
        try:
            while True:
                if max_cycles is not None and attempts >= max_cycles:
                    return 0
                if duration is not None and self.clock() - start >= duration:
                    return 0
                attempts += 1
                try:
                    if not self.connected:
                        self.source.connect()
                        self.connected = True
                        self.symbols_sent_at = None
                        self.log(
                            "Simulador pronto (DADOS SIMULADOS)."
                            if self.source.mode == "simulated"
                            else "Conectado ao MetaTrader 5."
                        )
                    self.cycle()
                    backoff = 1.0
                    self.sleep(self.cfg.poll_seconds)
                except MissingPackageError as e:
                    self.log(f"MetaTrader 5: {e}")
                    return 4
                except SourceError as e:
                    self.log(f"MetaTrader 5: {e} Nova tentativa em 10 s.")
                    self.connected = False
                    self.source.close()
                    self._heartbeat(str(e))
                    self.sleep(10)
                except AuthError as e:
                    self.log(f"O Radar recusou o token: {e} Nova tentativa em 60 s.")
                    self.sleep(60)
                except RefusedError as e:
                    self.log(f"O Radar recusou o envio: {e}")
                    return 3
                except BadRequestError as e:
                    self.log(f"O Radar não entendeu o envio ({e}). O agente está atualizado?")
                    self.sleep(10)
                except NetworkError as e:
                    wait = e.retry_after or backoff
                    self.log(f"{e}; nova tentativa em {wait:.0f} s.")
                    self.sleep(wait)
                    backoff = min(backoff * 2, 60.0)
        except KeyboardInterrupt:
            self.log("Agente encerrado.")
            return 0
        finally:
            self.source.close()
