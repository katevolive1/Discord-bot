@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
powershell -NoProfile -ExecutionPolicy Bypass -File tat-quickedit.ps1
node index.js
pause
