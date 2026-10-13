"""Envio ao servidor do Radar: HTTPS de saída (sem abrir portas no PC), token no cabeçalho."""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from typing import Any, Callable, Dict, Optional

from . import VERSION

INGEST_PATH = "/api/mt5/ingest"


class ClientError(Exception):
    """Erro ao falar com o Radar."""


class AuthError(ClientError):
    """Token recusado (401): gerar outro no Radar."""


class RefusedError(ClientError):
    """O Radar recusou o envio (403), ex.: dados simulados num Radar de produção."""


class BadRequestError(ClientError):
    """O Radar não entendeu o envio (400 ou 413)."""


class NetworkError(ClientError):
    """Sem conexão, tempo esgotado ou servidor com erro (5xx/429): tentar de novo depois."""

    def __init__(self, message: str, retry_after: Optional[float] = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


Opener = Callable[..., Any]


class RadarClient:
    def __init__(self, url: str, token: str, timeout: float = 30.0, opener: Optional[Opener] = None):
        self.endpoint = url.rstrip("/") + INGEST_PATH
        self.token = token
        self.timeout = timeout
        self._open = opener or urllib.request.urlopen

    def post(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        data = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
        req = urllib.request.Request(
            self.endpoint,
            data=data,
            method="POST",
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {self.token}",
                "user-agent": f"radar-mt5-bridge/{VERSION}",
            },
        )
        try:
            with self._open(req, timeout=self.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            msg = _error_message(e)
            if e.code == 401:
                raise AuthError(msg) from None
            if e.code == 403:
                raise RefusedError(msg) from None
            if e.code in (400, 413):
                raise BadRequestError(msg) from None
            retry = None
            if e.code == 429:
                try:
                    retry = float(e.headers.get("retry-after", "") or 0) or None
                except ValueError:
                    retry = None
            raise NetworkError(f"o Radar respondeu {e.code}: {msg}", retry) from None
        except (urllib.error.URLError, socket.timeout, ConnectionError, OSError) as e:
            reason = getattr(e, "reason", e)
            raise NetworkError(f"sem conexão com o Radar ({reason})") from None
        except ValueError:
            raise NetworkError("resposta inesperada do Radar (não é JSON)") from None


def _error_message(e: "urllib.error.HTTPError") -> str:
    try:
        body = json.loads(e.read().decode("utf-8"))
        if isinstance(body, dict) and body.get("error"):
            return str(body["error"])
    except Exception:  # corpo vazio ou não-JSON
        pass
    return f"erro {e.code}"
