import math
import unittest

from mt5bridge.sources import (
    MetaTraderSource,
    MissingPackageError,
    OffsetDetector,
    SimulatedSource,
    SourceError,
)

from .fakes import FakeMT5

NOW = 1_768_402_800.0  # 14/01/2026 15:00 UTC (quarta)


def valid(rate):
    t, o, h, lo, c, tv, sp, rv = rate
    return h >= max(o, c) and lo <= min(o, c) and lo > 0 and tv >= 0 and rv >= 0


class SimulatorTest(unittest.TestCase):
    def setUp(self):
        self.now = NOW
        self.sim = SimulatedSource(clock=lambda: self.now)

    def test_barras_plausiveis_alinhadas_e_deterministicas(self):
        for tf, step in (("1m", 60), ("5m", 300), ("15m", 900), ("30m", 1800), ("60m", 3600)):
            r = self.sim.rates("EURUSD", tf, 50)
            self.assertEqual(len(r), 50, tf)
            self.assertTrue(all(valid(x) for x in r), tf)
            self.assertTrue(all(x[0] % step == 0 for x in r), tf)
            self.assertTrue(all(b[0] - a[0] == step for a, b in zip(r, r[1:])), tf)
            self.assertLessEqual(r[-1][0], self.now)
        again = SimulatedSource(clock=lambda: NOW).rates("EURUSD", "5m", 50)
        self.assertEqual(again, self.sim.rates("EURUSD", "5m", 50))

    def test_escalas_maiores_batem_com_o_minuto(self):
        m1 = self.sim.rates("PETR4", "1m", 60)
        h1 = self.sim.rates("PETR4", "60m", 2)
        hour_start = h1[-1][0]
        inside = [x for x in m1 if x[0] >= hour_start]
        self.assertEqual(h1[-1][1], inside[0][1])  # abertura
        self.assertEqual(h1[-1][4], inside[-1][4])  # fechamento
        self.assertEqual(h1[-1][2], max(x[2] for x in inside))
        self.assertEqual(h1[-1][5], sum(x[5] for x in inside))

    def test_diario_longo_e_valido(self):
        d = self.sim.rates("WIN$N", "1d", 3000)
        self.assertEqual(len(d), 3000)
        self.assertTrue(all(valid(x) for x in d))
        self.assertTrue(all(x[0] % 86400 == 0 for x in d))
        closes = [x[4] for x in d]
        self.assertGreater(len(set(closes)), 2500)  # não é uma linha reta
        # preços no tick do mini-índice (5 pontos)
        self.assertTrue(all(abs(x[4] / 5 - round(x[4] / 5)) < 1e-9 for x in d[-50:]))
        # variação diária típica plausível (nada de saltos absurdos)
        rets = [abs(math.log(b / a)) for a, b in zip(closes, closes[1:])]
        self.assertLess(max(rets), 0.15)

    def test_candle_em_formacao_evolui_e_forex_sem_volume_real(self):
        a = self.sim.rates("EURUSD", "1m", 1)[-1]
        self.now += 20
        b = self.sim.rates("EURUSD", "1m", 1)[-1]
        self.assertEqual(a[0], b[0])
        self.assertGreaterEqual(b[5], a[5])
        self.assertEqual(b[7], 0)  # forex: real_volume zero, só tick volume
        self.assertGreater(self.sim.rates("PETR4", "1m", 1)[-1][7], 0)

    def test_info_marcada_como_simulada(self):
        info = self.sim.symbol_info("EURUSD")
        self.assertIn("SIMULADO", info["description"])
        self.assertEqual(info["trade_calc_mode"], 0)
        self.assertEqual(self.sim.symbol_info("WIN$N")["currency_profit"], "BRL")
        self.assertIn("SIMULADO", self.sim.symbol_info("QUALQUER")["description"])
        self.assertIn("SIMULADOS", self.sim.status()["company"])


class MetaTraderSourceTest(unittest.TestCase):
    def test_conecta_sem_senha_e_le_so_dados(self):
        fake = FakeMT5()
        src = MetaTraderSource(module=fake)
        src.connect()
        self.assertEqual(src.status(), {"terminalConnected": True, "company": "Corretora Falsa S.A."})
        info = src.symbol_info("EURUSD")
        self.assertEqual(info["trade_contract_size"], 100000.0)
        self.assertEqual(info["trade_calc_mode"], 0)
        self.assertNotIn("bid", info)  # só os campos do protocolo
        self.assertIsNone(src.symbol_info("NAOEXISTE"))
        fake.rates[("EURUSD", fake.TIMEFRAME_H1)] = [
            {"time": 100, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "tick_volume": 9, "spread": 1, "real_volume": 0},
            (3700, 1.5, 2, 1, 1.2, 4, 1, 0),
        ]
        rows = src.rates("EURUSD", "60m", 2)
        self.assertEqual(rows, [[100, 1.0, 2.0, 0.5, 1.5, 9.0, 1.0, 0.0], [3700, 1.5, 2.0, 1.0, 1.2, 4.0, 1.0, 0.0]])
        self.assertEqual(fake.last_rates_call, ("EURUSD", 1 | 0x4000, 0, 2))
        self.assertEqual(src.last_tick("EURUSD"), (fake.tick.time, fake.tick.time_msc))
        src.close()
        allowed = {
            "initialize",
            "shutdown",
            "last_error",
            "terminal_info",
            "symbol_select",
            "symbol_info",
            "symbol_info_tick",
            "copy_rates_from_pos",
        }
        self.assertTrue(set(fake.calls) <= allowed, fake.calls)

    def test_pede_no_maximo_10_mil_barras_e_explica_falhas(self):
        fake = FakeMT5()
        src = MetaTraderSource(module=fake)
        fake.rates[("EURUSD", 24 | 0x4000)] = []
        src.rates("EURUSD", "1d", 50_000)
        self.assertEqual(fake.last_rates_call[3], 10_000)
        with self.assertRaisesRegex(SourceError, "não entregou barras"):
            src.rates("EURUSD", "5m", 3)
        with self.assertRaisesRegex(SourceError, "aberto e logado"):
            MetaTraderSource(module=FakeMT5(init_ok=False)).connect()

    def test_registro_do_numpy(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("numpy não instalado")
        dt = np.dtype(
            [("time", "<i8"), ("open", "<f8"), ("high", "<f8"), ("low", "<f8"), ("close", "<f8"),
             ("tick_volume", "<u8"), ("spread", "<i4"), ("real_volume", "<u8")]
        )
        fake = FakeMT5()
        fake.rates[("EURUSD", 1)] = np.array([(60, 1.0, 1.1, 0.9, 1.05, 7, 2, 3)], dtype=dt)
        self.assertEqual(MetaTraderSource(module=fake).rates("EURUSD", "1m", 1), [[60, 1.0, 1.1, 0.9, 1.05, 7.0, 2.0, 3.0]])

    def test_sem_o_pacote_oficial(self):
        src = MetaTraderSource()
        try:
            import MetaTrader5  # noqa: F401
        except ImportError:
            with self.assertRaisesRegex(MissingPackageError, "pip install MetaTrader5"):
                src.connect()
        else:  # pragma: no cover (só no Windows com o pacote)
            self.skipTest("pacote MetaTrader5 instalado")


class OffsetDetectorTest(unittest.TestCase):
    def test_mede_so_com_ticks_novos(self):
        now = [NOW]
        d = OffsetDetector(clock=lambda: now[0])
        server = lambda: int(now[0] + 3 * 3600 + 2)  # relógio do servidor UTC+3, PC 2 s atrasado
        d.observe("EURUSD", server(), 1)
        self.assertIsNone(d.value)
        d.observe("EURUSD", server(), 1)  # mesmo tick: mercado parado, não mede
        self.assertIsNone(d.value)
        for i in range(2, 5):
            now[0] += 1
            d.observe("EURUSD", server(), i)
        self.assertEqual(d.value, 180)

    def test_mercado_parado_nao_inventa(self):
        now = [NOW]
        d = OffsetDetector(clock=lambda: now[0])
        for _ in range(10):
            now[0] += 1
            d.observe("EURUSD", int(NOW - 3 * 86400), 42)  # tick velho de sexta, sempre igual
        self.assertIsNone(d.value)


if __name__ == "__main__":
    unittest.main()
