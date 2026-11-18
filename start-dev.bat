@echo off
rem Starts the API (http://localhost:5000) and the website (http://localhost:5173)
rem in two windows. Close those windows to stop them.
cd /d "%~dp0"
if not exist server\node_modules (
  echo Packages are not installed yet. Run setup.bat first.
  pause
  exit /b 1
)
start "blogSite API  - port 5000" cmd /k "cd /d "%~dp0server" && npm run dev"
start "blogSite Web  - port 5173" cmd /k "cd /d "%~dp0client" && npm run dev"
echo.
echo Website:  http://localhost:5173
echo Admin:    http://localhost:5173/admin
echo.
timeout /t 5 >nul
