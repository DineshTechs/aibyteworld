@echo off
rem ============================================================
rem  blogSite setup: checks the environment, installs packages,
rem  creates the first administrator and runs the API tests.
rem  Safe to run more than once. Output is saved in the logs folder.
rem ============================================================
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
set "LOG=%~dp0logs\setup.log"

echo ==== blogSite setup %date% %time% ==== > "%LOG%"

echo [1/6] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo STEP 1 FAIL: Node.js not found >> "%LOG%"
  echo.
  echo Node.js is not installed. Install the LTS version from https://nodejs.org and run setup.bat again.
  goto :end
)
(
  echo --- environment ---
  ver
  echo node:
  node -v
  echo npm:
  call npm -v
  echo git:
  git --version
) >> "%LOG%" 2>&1
echo STEP 1 OK >> "%LOG%"

echo [2/6] Installing server packages (this can take a few minutes)...
cd /d "%~dp0server"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 (
  echo STEP 2 FAIL: server npm install >> "%LOG%"
  echo Server package installation failed. See logs\setup.log
  goto :end
)
echo STEP 2 OK >> "%LOG%"

echo [3/6] Installing client packages (this can take a few minutes)...
cd /d "%~dp0client"
call npm install >> "%LOG%" 2>&1
if errorlevel 1 (
  echo STEP 3 FAIL: client npm install >> "%LOG%"
  echo Client package installation failed. See logs\setup.log
  goto :end
)
echo STEP 3 OK >> "%LOG%"

echo [4/6] Checking configuration...
cd /d "%~dp0server"
if not exist .env copy .env.example .env >nul
call npm run --silent gen:secret >> "%LOG%" 2>&1
node src\scripts\checkEnv.js >> "%LOG%" 2>&1
if errorlevel 1 (
  echo STEP 4 WAITING: server\.env needs values >> "%LOG%"
  echo.
  echo ------------------------------------------------------------
  echo  One manual step: Notepad will open server\.env
  echo  Fill in these three lines, save, close Notepad,
  echo  then run setup.bat again:
  echo.
  echo    MONGODB_URI=    your MongoDB Atlas connection string
  echo    ADMIN_EMAIL=    the email you will sign in with
  echo    ADMIN_PASSWORD= a password of at least 10 characters
  echo ------------------------------------------------------------
  start "" notepad "%~dp0server\.env"
  goto :end
)
echo STEP 4 OK >> "%LOG%"

echo [5/6] Creating the administrator account...
call npm run --silent seed:admin >> "%LOG%" 2>&1
if errorlevel 1 (
  echo STEP 5 FAIL: seed admin >> "%LOG%"
  echo Could not connect to MongoDB or create the administrator. See logs\setup.log
  echo Check MONGODB_URI and that your IP address is allowed in Atlas ^(Network Access^).
  goto :end
)
echo STEP 5 OK >> "%LOG%"

echo [6/6] Running API tests...
call npm test > "%~dp0logs\test.log" 2>&1
if errorlevel 1 (
  echo STEP 6 FAIL: tests - see logs\test.log >> "%LOG%"
  echo Some tests failed. See logs\test.log
  goto :end
)
echo STEP 6 OK >> "%LOG%"
echo SETUP COMPLETE >> "%LOG%"
echo.
echo Setup complete. Double-click start-dev.bat to run the site.

:end
echo.
pause
endlocal
