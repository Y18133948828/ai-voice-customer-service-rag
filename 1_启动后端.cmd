@echo off
chcp 65001 >nul
cd /d "%~dp0"
node Server\check-config.js
if errorlevel 1 (
  pause
  exit /b 1
)
node Server\app.js
pause
