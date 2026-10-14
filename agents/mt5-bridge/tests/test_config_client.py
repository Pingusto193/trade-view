import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from mt5bridge import VERSION
from mt5bridge.client import AuthError, BadRequestError, NetworkError, RadarClient, RefusedError
from mt5bridge.config import ConfigError, check_url, load

TOKEN = "rmt5_abcdefghijklmnopqrstuvwxyz"


def write_ini(text: str) -> str:
    fd, path = tempfile.mkstemp(suffix=".ini")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    return path


class ConfigTest(unittest.TestCase):
    def test_le_o_arquivo_com_cifrao_e_mercados(self):
        path = write_ini(
            "[radar]\nurl = https://radar.exemplo.com.br/\ntoken = " + TOKEN + "\n"
            "[mt5]\nsymbols = WIN$N, WDO$N; PETR4  EURUSD.a\nmarket = auto\n"
            "server_timezone = NY+7\npoll_seconds = 2\n[mercados]\nEURUSD.a = forex\n"
        )
        self.addCleanup(os.remove, path)
        cfg = load(path, env={})
        self.assertEqual(cfg.url, "https://radar.exemplo.com.br")
        self.assertEqual(cfg.symbols, ["WIN$N", "WDO$N", "PETR4", "EURUSD.a"])
        self.assertEqual(cfg.market_for("EURUSD.a"), "forex")
        self.assertEqual(cfg.market_for("PETR4"), "auto")
        self.assertEqual(cfg.server_timezone, "NY+7")
        self.assertEqual(cfg.poll_seconds, 2.0)

    def test_token_pela_variavel_de_ambiente_e_linha_de_comando(self):
        cfg = load(None, url="http://localhost:8787", symbols="EURUSD", env={"RADAR_MT5_TOKEN": TOKEN})
        self.assertEqual(cfg.token, TOKEN)
        cfg2 = load(None, url="http://127.0.0.1:8787", token=TOKEN, symbols="X", env={})
        self.assertEqual(cfg2.symbols, ["X"])

    def test_erros_explicados(self):
        with self.assertRaisesRegex(ConfigError, "Falta o token"):
            load(None, url="https://r.com", symbols="A", env={})
        with self.assertRaisesRegex(ConfigError, "Falta o token"):
            load(None, url="https://r.com", token="cole-aqui-o-token", symbols="A", env={})
        with self.assertRaisesRegex(ConfigError, "Nenhum ativo"):
            load(None, url="https://r.com", token=TOKEN, env={})
        with self.assertRaisesRegex(ConfigError, "inválido"):
            load(None, url="https://r.com", token=TOKEN, symbols="PETR 4,A:B", env={})
        # teste de conexão não precisa de ativos
        self.assertEqual(load(None, url="https://r.com", token=TOKEN, require_symbols=False, env={}).symbols, [])
        with self.assertRaisesRegex(ConfigError, "não encontrado"):
            load("nao-existe.ini", env={})

    def test_https_obrigatorio_fora_de_casa(self):
        with self.assertRaisesRegex(ConfigError, "https://"):
            check_url("http://radar.exemplo.com.br")
        self.assertEqual(check_url("http://192.168.0.10:8787/"), "http://192.168.0.10:8787")
        self.assertEqual(check_url("http://localhost:5173"), "http://localhost:5173")
        with self.assertRaises(ConfigError):
            check_url("radar.exemplo.com.br")

    def test_simulador_usa_ativos_padrao_e_relogio_utc(self):
        cfg = load(None, url="http://localhost:8787", token=TOKEN, simulate=True, env={})
        self.assertIn("EURUSD", cfg.symbols)
        self.assertIn("WIN$N", cfg.symbols)
        self.assertEqual(cfg.server_timezone, "UTC")


class _Handler(BaseHTTPRequestHandler):
    status = 200
    body = {"ok": True, "wants": [], "history": [], "messages": []}
    seen = []

    def do_POST(self):  # noqa: N802 (nome exigido pelo http.server)
        n = int(self.headers.get("content-length", "0"))
        _Handler.seen.append(
            {
                "path": self.path,
                "auth": self.headers.get("authorization"),
                "ua": self.headers.get("user-agent"),
                "json": json.loads(self.rfile.read(n)),
            }
        )
        out = json.dumps(_Handler.body).encode()
        self.send_response(_Handler.status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


class ClientTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), _Handler)
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        _Handler.status = 200
        _Handler.body = {"ok": True, "wants": [], "history": [], "messages": []}
        _Handler.seen = []

    def test_envia_com_token_no_cabecalho(self):
        r = RadarClient(self.url, TOKEN).post({"protocol": 1})
        self.assertTrue(r["ok"])
        s = _Handler.seen[0]
        self.assertEqual(s["path"], "/api/mt5/ingest")
        self.assertEqual(s["auth"], f"Bearer {TOKEN}")
        self.assertEqual(s["ua"], f"radar-mt5-bridge/{VERSION}")
        self.assertEqual(s["json"], {"protocol": 1})

    def test_erros_do_radar_viram_excecoes_com_a_mensagem(self):
        c = RadarClient(self.url, TOKEN)
        for status, exc in ((401, AuthError), (403, RefusedError), (400, BadRequestError), (502, NetworkError)):
            _Handler.status = status
            _Handler.body = {"error": f"motivo {status}"}
            with self.assertRaises(exc) as ctx:
                c.post({})
            self.assertIn(f"motivo {status}", str(ctx.exception))

    def test_sem_servidor_e_erro_de_rede(self):
        c = RadarClient("http://127.0.0.1:9", TOKEN, timeout=2)
        with self.assertRaises(NetworkError):
            c.post({})


if __name__ == "__main__":
    unittest.main()
