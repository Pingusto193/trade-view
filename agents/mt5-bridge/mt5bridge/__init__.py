"""Agente MetaTrader 5 do Radar (ADR-0023, guia em docs/GUIA_MT5.md).

Lê candles do MetaTrader 5 aberto no PC do usuário e envia ao servidor do Radar por HTTPS, com o token
gerado na tela "Fontes de dados". SÓ LÊ dados: nunca envia ordens, nunca lê a conta e nunca pede a
senha da corretora (usa o MT5 que já está logado).

Só a biblioteca padrão do Python é obrigatória; o pacote oficial `MetaTrader5` (só Windows) é
importado apenas no modo real.
"""

VERSION = "1.0.0"
PROTOCOL = 1
