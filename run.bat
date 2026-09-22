@echo off
cd /d "%~dp0"
start "" /min cmd /c "python serve.py"
timeout /t 2 /nobreak >nul
start "" http://localhost:9001/