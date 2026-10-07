@echo off
chcp 65001 > nul
echo ===================================================
echo [START] KHỞI ĐỘNG ZALO VIDEO BOT RUNNER (LOCAL)
echo ===================================================
cd /d "%~dp0"
node local/cli.mjs start
pause
