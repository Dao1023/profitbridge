@echo off
rem Start Goldpit3 profit bridge dashboard at http://127.0.0.1:8440
cd /d "%~dp0"
start "goldpit3-serve" /min cmd /c "node scripts\serve.mjs 8440"
timeout /t 1 /nobreak >nul
start http://127.0.0.1:8440/
echo Goldpit3 started at http://127.0.0.1:8440/ (server runs in a minimized window; close it to stop).
