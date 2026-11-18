@echo off
rem Builds the website and runs everything from one server on http://localhost:5000
rem with search-engine tags written into each page by the server (best for SEO).
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
echo Building the website (about a minute)...
cd client
call npm run build > "%~dp0logs\build.log" 2>&1
if errorlevel 1 (
  echo Build failed - see logs\build.log
  pause
  exit /b 1
)
cd ..\server
set NODE_ENV=production
echo.
echo Website and admin:  http://localhost:5000
echo Sitemap:            http://localhost:5000/sitemap.xml
echo Close this window to stop.
echo.
call npm start
pause
