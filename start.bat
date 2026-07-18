@echo off
setlocal

cd /d "%~dp0"

if not exist node_modules (
  call npm install
  if errorlevel 1 pause & exit /b 1
)

echo Starting PUBG Ranked Overlay...
echo OBS Browser URL example:
echo http://localhost:3000/overlay.html?platform=steam^&player=YOUR_NICK^&mode=fpp-squad^&refresh=60000
echo.

call npm start
