@echo off
rem Inicia o agente MT5 do Radar. Deixe esta janela aberta (pode minimizar).
rem Guia: docs\GUIA_MT5.md. O agente so le dados: nunca envia ordens.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 radar_mt5.py --config config.ini
) else (
  python radar_mt5.py --config config.ini
)
echo.
echo O agente parou. Leia a mensagem acima.
pause
