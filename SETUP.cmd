@echo off
chcp 65001 > nul
echo ===================================================
echo [SETUP] KIỂM TRA VÀ THIẾT LẬP HỆ THỐNG
echo ===================================================
cd /d "%~dp0"
node local/cli.mjs doctor
echo.
pause
