#!/usr/bin/env python3
"""Agente MetaTrader 5 do Radar.

Uso no Windows (na pasta do agente):
    py radar_mt5.py --check        testa o endereço e o token
    py radar_mt5.py                lê o MT5 e envia ao Radar (deixe a janela aberta)
    py radar_mt5.py --simulate     DADOS SIMULADOS, sem MT5 (só para testar)

Guia passo a passo: docs/GUIA_MT5.md. O agente só lê dados: nunca envia ordens.
"""

import sys

from mt5bridge.cli import main

if __name__ == "__main__":
    sys.exit(main())
