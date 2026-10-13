"""Linha de comando do agente (`py radar_mt5.py --help`)."""

from __future__ import annotations

import argparse
import os
import sys
from typing import List, Optional

from . import PROTOCOL, VERSION
from .agent import Agent, default_log
from .client import ClientError, RadarClient
from .config import ConfigError, load
from .sources import MetaTraderSource, SimulatedSource

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _fix_console() -> None:
    # Console do Windows antigo: troca o que não couber por "?" em vez de travar com acentos.
    for stream in (sys.stdout, sys.stderr):
        reconf = getattr(stream, "reconfigure", None)
        if reconf:
            try:
                reconf(errors="replace")
            except Exception:
                pass


def check(client: RadarClient, server_tz: str) -> int:
    """Teste de conexão: confere endereço e token, sem mandar dados nem precisar do MT5."""
    payload = {
        "protocol": PROTOCOL,
        "agent": {
            "version": VERSION,
            "mode": "check",
            "terminalConnected": False,
            "serverTz": server_tz,
            "detectedOffsetMin": None,
        },
        "bars": [],
        "errors": [],
    }
    try:
        resp = client.post(payload)
    except ClientError as e:
        default_log(f"FALHOU: {e}")
        return 1
    for m in resp.get("messages", []):
        default_log(m)
    default_log("Tudo certo: o Radar recebeu o teste. Veja em Mais → Fontes de dados.")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        prog="radar_mt5",
        description=(
            "Agente MetaTrader 5 do Radar: lê candles do MT5 aberto neste PC (só leitura, nunca envia "
            "ordens) e manda para o seu Radar. Guia: docs/GUIA_MT5.md."
        ),
    )
    ap.add_argument("--config", help="arquivo de configuração (padrão: config.ini nesta pasta)")
    ap.add_argument("--url", help="endereço do Radar (substitui o do config.ini)")
    ap.add_argument("--token", help="token do agente (prefira o config.ini ou RADAR_MT5_TOKEN)")
    ap.add_argument("--symbols", help="ativos separados por vírgula (substitui o do config.ini)")
    ap.add_argument(
        "--simulate",
        action="store_true",
        help="DADOS SIMULADOS, sem MT5 (para testar a ponte; um Radar de produção recusa)",
    )
    ap.add_argument(
        "--check", action="store_true", help="só testa o endereço e o token, sem mandar dados"
    )
    ap.add_argument("--once", action="store_true", help="faz um único envio e sai")
    ap.add_argument("--duration", type=float, help="para depois de N segundos")
    ap.add_argument("--version", action="version", version=f"radar_mt5 {VERSION}")
    args = ap.parse_args(argv)
    _fix_console()

    path = args.config
    if path is None:
        candidate = os.path.join(HERE, "config.ini")
        path = candidate if os.path.exists(candidate) else None
    try:
        cfg = load(
            path,
            url=args.url,
            token=args.token,
            symbols=args.symbols,
            simulate=args.simulate,
            require_symbols=not args.check,
        )
    except ConfigError as e:
        default_log(f"Configuração: {e}")
        return 2

    client = RadarClient(cfg.url, cfg.token)
    if args.check:
        return check(client, cfg.server_timezone)
    source = SimulatedSource() if args.simulate else MetaTraderSource(cfg.terminal_path)
    agent = Agent(cfg, source, client)
    return agent.run(max_cycles=1 if args.once else None, duration=args.duration)
