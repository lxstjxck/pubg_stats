@echo off
setlocal

cd /d "%~dp0"

echo PUBG Ranked Overlay setup
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not available in PATH.
  echo Install Node.js 18 or newer from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
  )
)

if not exist .env (
  echo.
  set /p PUBG_KEY=Paste your PUBG API key:
  if "%PUBG_KEY%"=="" (
    echo ERROR: PUBG API key is required.
    pause
    exit /b 1
  )
  > .env echo PUBG_API_KEY=%PUBG_KEY%
  >> .env echo PORT=3000
  echo Created local .env file.
) else (
  echo Existing .env file found. Keeping it unchanged.
)

echo.
echo Setup complete.
echo Run start.bat and use this OBS Browser URL:
echo http://localhost:3000/overlay.html?platform=steam^&player=YOUR_NICK^&mode=fpp-squad^&refresh=60000
echo.
pause
