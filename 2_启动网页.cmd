@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "PORT=3002"
set "BROWSER=none"
call npm start
pause
