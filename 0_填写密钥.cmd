@echo off
chcp 65001 >nul
cd /d "%~dp0"
node Server\setup-config.js
pause
