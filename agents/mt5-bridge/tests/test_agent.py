import pathlib
import re
import unittest

from mt5bridge.agent import Agent
from mt5bridge.client import AuthError, NetworkError, RefusedError
from mt5bridge.config import Config
from mt5bridge.sources import MetaTraderSource, SimulatedSource

from .fakes import FakeClient, FakeMT5

NOW = 1_768_402_800.0
ROOT = pathlib.Path(__file__).resolve().parents[1]


def cfg(**kw):
    base = dict(url="http://localhost:8787", token="rmt5_" + "x" * 20, symbols=["EURUSD", "WIN$N"])
    base.update(kw)
    return Config(**base)


def make(responses=None, symbols=None, source=None):
    now = [NOW]
    logs = []
    client = FakeClient(responses)
    agent = Agent(
        cfg(**({"symbols": symbols} if symbols else {})),
        source or SimulatedSource(clock=lambda: now[0]),
        client,
        log=logs.append,
        clock=lambda: now[0],
        sleep=lambda s: now.__setitem__(0, now[0] + s),
    )
    return agent, client, logs, now


def resp(wants=(), history=(), messages=()):
    return {
        "ok": True,
        "serverTime": 0,
        "wants": [{"symbol": s, "tf": tf} for s, tf in wants],
        "history": [{"symbol": s, "tf": tf, "count": n} for s, tf, n in history],
        "messages": list(messages),
    }


class AgentTest(unittest.TestCase):
    def test_primeiro_envio_anuncia_os_ativos_e_o_modo(self):
        agent, client, _, _ = make()
        agent.cycle()
        p = client.sent[0]
        self.assertEqual(p["protocol"], 1)
        self.assertEqual(p["agent"]["mode"], "simulated")
        self.assertTrue(p["agent"]["terminalConnected"])
        self.assertEqual([s["name"] for s in p["symbols"]], ["EURUSD", "WIN$N"])
        self.assertEqual(p["symbols"][0]["market"], "auto")
        self.assertEqual(p["bars"], [])
        # o segundo envio não repete os ativos (só a cada 5 min)
        agent.cycle()
        self.assertNotIn("symbols", client.sent[1])

    def test_historico_pedido_e_tempo_real_do_que_o_radar_acompanha(self):
        agent, client, _, _ = make(
            [resp(wants=[("EURUSD", "1m")], history=[("EURUSD", "5m", 120)]), resp(wants=[("EURUSD", "1m")])]
        )
        agent.cycle()
        agent.cycle()
        bars = client.sent[1]["bars"]
        hist = [b for b in bars if b.get("history")]
        live = [b for b in bars if not b.get("history")]
        self.assertEqual([(b["symbol"], b["tf"], len(b["rates"])) for b in hist], [("EURUSD", "5m", 120)])
        self.assertEqual([(b["symbol"], b["tf"], len(b["rates"])) for b in live], [("EURUSD", "1m", 3)])
        self.assertLess(bars.index(hist[0]), bars.index(live[0]))  # histórico antes do tempo real
        agent.cycle()  # histórico já mandado não volta
        self.assertFalse(any(b.get("history") for b in client.sent[2]["bars"]))

    def test_no_maximo_3_historicos_por_envio(self):
        hist = [("EURUSD", tf, 10) for tf in ("1m", "5m", "15m", "30m", "60m")]
        agent, client, _, _ = make([resp(history=hist)])
        agent.cycle()
        agent.cycle()
        agent.cycle()
        self.assertEqual(sum(1 for b in client.sent[1]["bars"] if b.get("history")), 3)
        self.assertEqual(sum(1 for b in client.sent[2]["bars"] if b.get("history")), 2)

    def test_ativo_inexistente_vira_problema_visivel_no_radar(self):
        fake = FakeMT5()
        agent, client, _, _ = make(symbols=["EURUSD", "XPTO11"], source=MetaTraderSource(module=fake))
        agent.source.connect()
        agent.cycle()
        p = client.sent[0]
        self.assertEqual([s["name"] for s in p["symbols"]], ["EURUSD"])
        self.assertEqual(p["errors"][0]["symbol"], "XPTO11")
        self.assertIn("Observação de Mercado", p["errors"][0]["message"])
        self.assertEqual(p["agent"]["company"], "Corretora Falsa S.A.")

    def test_mede_o_fuso_pelos_ticks(self):
        fake = FakeMT5()
        agent, client, _, now = make(symbols=["EURUSD"], source=MetaTraderSource(module=fake))
        agent.source.connect()
        for i in range(5):
            fake.tick.time = int(now[0]) + 2 * 3600
            fake.tick.time_msc = 1000 + i
            agent.cycle()
            now[0] += 1
        self.assertEqual(client.sent[-1]["agent"]["detectedOffsetMin"], 120)

    def test_mensagens_do_radar_aparecem_uma_vez(self):
        agent, _, logs, _ = make([resp(messages=["aviso X"]), resp(messages=["aviso X"])])
        agent.cycle()
        agent.cycle()
        self.assertEqual([m for m in logs if "aviso X" in m], ["Radar: aviso X"])

    def test_reconecta_sozinho_depois_de_falha_de_rede(self):
        agent, client, logs, _ = make([NetworkError("sem conexão"), NetworkError("sem conexão"), resp()])
        code = agent.run(max_cycles=3)
        self.assertEqual(code, 0)
        self.assertEqual(len(client.sent), 3)
        self.assertTrue(any("nova tentativa em 1 s" in m for m in logs))
        self.assertTrue(any("nova tentativa em 2 s" in m for m in logs))

    def test_radar_de_producao_recusa_o_simulador_e_o_agente_para(self):
        agent, _, logs, _ = make([RefusedError("Este Radar recusa DADOS SIMULADOS")])
        self.assertEqual(agent.run(max_cycles=5), 3)
        self.assertTrue(any("DADOS SIMULADOS" in m for m in logs))

    def test_token_recusado_espera_e_tenta_de_novo(self):
        agent, client, logs, now = make([AuthError("token inválido"), resp()])
        start = now[0]
        agent.run(max_cycles=2)
        self.assertGreaterEqual(now[0] - start, 60)
        self.assertEqual(len(client.sent), 2)

    def test_mt5_fechado_avisa_o_radar_e_tenta_reconectar(self):
        fake = FakeMT5(init_ok=False)
        agent, client, logs, _ = make(source=MetaTraderSource(module=fake))
        agent.run(max_cycles=2)
        self.assertTrue(client.sent)
        hb = client.sent[0]
        self.assertFalse(hb["agent"]["terminalConnected"])
        self.assertEqual(hb["bars"], [])
        self.assertIn("aberto e logado", hb["errors"][0]["message"])
        self.assertTrue(any("Nova tentativa em 10 s" in m for m in logs))

    def test_sem_pacote_metatrader5_sai_com_codigo_4(self):
        try:
            import MetaTrader5  # noqa: F401
        except ImportError:
            agent, _, logs, _ = make(source=MetaTraderSource())
            self.assertEqual(agent.run(max_cycles=1), 4)
            self.assertTrue(any("pip install MetaTrader5" in m for m in logs))
        else:  # pragma: no cover
            self.skipTest("pacote MetaTrader5 instalado")


class ReadOnlyTest(unittest.TestCase):
    """O agente só lê dados: nenhuma função de ordem, de conta ou de login no código."""

    FORBIDDEN = re.compile(
        r"\b(order_send|order_check|order_calc_margin|order_calc_profit|positions_get|positions_total|"
        r"orders_get|orders_total|history_deals_get|history_orders_get|account_info|login)\s*\(|"
        r"\.(Buy|Sell|Close)\s*\(|password\s*="
    )

    def test_codigo_do_agente_nao_envia_ordens_nem_le_a_conta(self):
        files = sorted((ROOT / "mt5bridge").glob("*.py")) + [ROOT / "radar_mt5.py"]
        self.assertGreater(len(files), 4)
        for f in files:
            text = f.read_text(encoding="utf-8")
            m = self.FORBIDDEN.search(text)
            self.assertIsNone(m, f"{f.name}: {m.group(0) if m else ''}")

    def test_exemplo_de_configuracao_nao_pede_senha(self):
        text = (ROOT / "config.example.ini").read_text(encoding="utf-8").lower()
        self.assertNotRegex(text, r"^\s*(password|senha|login)\s*=", "config pede senha")
        self.assertIn("nunca coloque aqui a senha", text)


if __name__ == "__main__":
    unittest.main()
