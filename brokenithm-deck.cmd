@echo off
setlocal
cd /d "%~dp0"
if "%HOST%"=="" set HOST=127.0.0.1
if "%PORT%"=="" set PORT=39868
node src\server.js
