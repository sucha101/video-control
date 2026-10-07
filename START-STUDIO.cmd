@echo off
chcp 65001 > nul
echo ===================================================
echo [START] VIDEO STUDIO PRODUCER / PUBLISHER
echo ===================================================
cd /d "%~dp0"
node local/studio-watcher.mjs
pause
