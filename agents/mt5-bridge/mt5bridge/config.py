"""Configuração do agente: arquivo `config.ini` (veja `config.example.ini`) + opções da linha de comando."""

from __future__ import annotations

import configparser
import ipaddress
import os
import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional
from urllib.parse import urlparse

MARKETS = ("auto", "b3", "forex")
SYMBOL_RE = re.compile(r"^[A-Za-z0-9._$#@&+!-]{1,40}$")
DEFAULT_SIM_SYMBOLS = ["EURUSD", "USDJPY", "WIN$N", "WDO$N", "PETR4"]


class ConfigError(Exception):
    """Configuração inválida (mensagem pronta para o usuário)."""


@dataclass
class Config:
    url: str
    token: str
    symbols: List[str]
    market: str = "auto"
    markets: Dict[str, str] = field(default_factory=dict)
    server_timezone: str = "auto"
    terminal_path: str = ""
    poll_seconds: float = 1.0

    def market_for(self, symbol: str) -> str:
        return self.markets.get(symbol.upper(), self.market)


def _is_local(host: str) -> bool:
    if host in ("localhost",) or host.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private


def check_url(url: str) -> str:
    url = url.strip().rstrip("/")
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname:
        raise ConfigError(
            f'Endereço do Radar inválido: "{url}". Use o endereço completo, ex.: '
            "https://radar.seudominio.com.br"
        )
    if p.scheme == "http" and not _is_local(p.hostname):
        raise ConfigError(
            "O endereço do Radar precisa começar com https:// — com http:// o token viajaria sem "
            "criptografia pela internet. (http:// só é aceito para o próprio PC ou a rede de casa.)"
        )
    return url


def check_token(token: str) -> str:
    token = token.strip()
    if not token or token.startswith("cole-aqui"):
        raise ConfigError(
            "Falta o token do agente. Gere um no Radar em Mais → Fontes de dados → "
            '"Gerar token" e cole em token = ... no config.ini.'
        )
    if len(token) < 10 or len(token) > 200 or any(c.isspace() for c in token):
        raise ConfigError("O token parece incompleto: copie de novo o token inteiro mostrado no Radar.")
    return token


def parse_symbols(text: str) -> List[str]:
    out: List[str] = []
    for raw in re.split(r"[,;\s]+", text or ""):
        s = raw.strip()
        if not s:
            continue
        if not SYMBOL_RE.match(s):
            raise ConfigError(f'Nome de ativo inválido: "{s}" (copie da Observação de Mercado do MT5).')
        if s not in out:
            out.append(s)
    if len(out) > 200:
        raise ConfigError("No máximo 200 ativos por agente.")
    return out


def _market(value: str, where: str) -> str:
    v = (value or "auto").strip().lower()
    if v not in MARKETS:
        raise ConfigError(f'{where}: mercado "{value}" inválido (use auto, b3 ou forex).')
    return v


def load(
    path: Optional[str],
    *,
    url: Optional[str] = None,
    token: Optional[str] = None,
    symbols: Optional[str] = None,
    simulate: bool = False,
    require_symbols: bool = True,
    env: Optional[Dict[str, str]] = None,
) -> Config:
    """Lê o arquivo (se houver) e aplica as opções da linha de comando e a variável RADAR_MT5_TOKEN."""
    env = dict(os.environ if env is None else env)
    cp = configparser.ConfigParser(interpolation=None)
    if path:
        if not os.path.exists(path):
            raise ConfigError(
                f'Arquivo de configuração "{path}" não encontrado. Copie config.example.ini para '
                "config.ini e preencha."
            )
        with open(path, encoding="utf-8-sig") as f:
            cp.read_file(f)
    radar = cp["radar"] if cp.has_section("radar") else {}
    mt5 = cp["mt5"] if cp.has_section("mt5") else {}

    final_url = check_url(url or radar.get("url", "") or "")
    final_token = check_token(token or env.get("RADAR_MT5_TOKEN") or radar.get("token", "") or "")
    syms = parse_symbols(symbols if symbols is not None else mt5.get("symbols", ""))
    if not syms:
        if simulate:
            syms = list(DEFAULT_SIM_SYMBOLS)
        elif require_symbols:
            raise ConfigError(
                "Nenhum ativo configurado: preencha symbols = ... no config.ini (ex.: WIN$N, PETR4)."
            )
    markets: Dict[str, str] = {}
    if cp.has_section("mercados"):
        for k, v in cp.items("mercados"):
            markets[k.upper()] = _market(v, f"[mercados] {k}")
    try:
        poll = float(mt5.get("poll_seconds", "1") or "1")
    except ValueError:
        raise ConfigError("poll_seconds precisa ser um número (ex.: 1).") from None
    if not 0.5 <= poll <= 60:
        raise ConfigError("poll_seconds precisa ficar entre 0,5 e 60 segundos.")
    tz = (mt5.get("server_timezone", "auto") or "auto").strip()
    return Config(
        url=final_url,
        token=final_token,
        symbols=syms,
        market=_market(mt5.get("market", "auto"), "market"),
        markets=markets,
        # no simulador o "servidor da corretora" é o próprio relógio UTC
        server_timezone="UTC" if simulate else tz,
        terminal_path=(mt5.get("terminal_path", "") or "").strip(),
        poll_seconds=poll,
    )
