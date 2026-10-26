@echo off
rem Start Profit Bridge dashboard at http://127.0.0.1:8440
cd /d "%~dp0"
start "profitbridge-serve" /min cmd /c "node scripts\serve.mjs 8440"
timeout /t 1 /nobreak >nul
start http://127.0.0.1:8440/
echo Profit Bridge started at http://127.0.0.1:8440/ (server runs in a minimized window; close it to stop).
