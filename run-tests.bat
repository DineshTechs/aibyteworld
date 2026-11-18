@echo off
rem Runs the API test suite and the website type check.
rem Results are saved to logs\test.log and logs\typecheck.log
cd /d "%~dp0"
if not exist logs mkdir logs
cd server
call npm test > "%~dp0logs\test.log" 2>&1
set TESTS=%errorlevel%
cd /d "%~dp0client"
call npm run typecheck > "%~dp0logs\typecheck.log" 2>&1
set TYPES=%errorlevel%
if not "%TESTS%"=="0" (echo Tests FAILED - see logs\test.log) else (echo All tests passed.)
if not "%TYPES%"=="0" (echo Type check FAILED - see logs\typecheck.log) else (echo Type check passed.)
pause
