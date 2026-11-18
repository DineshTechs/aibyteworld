@echo off
rem Connects this folder to the private GitHub repository and pushes it.
rem The first push opens a GitHub sign-in window (Git Credential Manager).
rem Later updates: run this again, or: git add -A, git commit -m "...", git push
setlocal
cd /d "%~dp0"
if not exist logs mkdir logs
set REPO=https://github.com/DineshTechs/aibyteworld.git

where git >nul 2>&1 || (echo Git is not installed: https://git-scm.com/download/win & pause & exit /b 1)

rem Never upload passwords and keys.
if exist server\.env (
  git check-ignore -q server\.env 2>nul
  if errorlevel 1 if exist .git (echo STOP: server\.env is not ignored. Nothing was uploaded. & pause & exit /b 1)
)

if not exist .git (
  echo Setting up Git in this folder...
  git init -q -b main || goto fail
  if not exist aibyteworld.bundle (echo aibyteworld.bundle is missing. & pause & exit /b 1)
  rem Start from the prepared, checked commit (same files as this folder).
  git fetch -q aibyteworld.bundle main:refs/remotes/bundle/main || goto fail
  git update-ref refs/heads/main refs/remotes/bundle/main || goto fail
  git reset -q || goto fail
)

git check-ignore -q server\.env || (echo STOP: server\.env would be uploaded. Nothing was uploaded. & pause & exit /b 1)

rem Build the website: the host runs the built copy in client\dist.
echo Building the website (about a minute)...
call npm --prefix client run build > logs\build.log 2>&1 || (echo Website build failed - see logs\build.log. Nothing was uploaded. & pause & exit /b 1)
if not exist client\dist\index.html (echo Website build is missing. Nothing was uploaded. & pause & exit /b 1)

rem Commit any later changes.
git add -A
rem Photos used by posts go to GitHub too, so the hosted site has them. They stay
rem listed in .gitignore, so photos saved on the live server are never removed by a redeploy.
git add -f server/uploads
git diff --cached --quiet || git -c user.name="DineshTechs" -c user.email="DineshTechs@users.noreply.github.com" commit -q -m "Update from %COMPUTERNAME% %DATE% %TIME%"

git remote get-url origin >nul 2>&1 && git remote set-url origin %REPO% || git remote add origin %REPO%
echo.
echo Uploading to %REPO% ...
git push -u origin main || goto fail
echo.
echo Done. Your code is on GitHub (private): %REPO%
git log --oneline -3
pause
exit /b 0

:fail
echo.
echo Something went wrong (see the message above). Nothing secret was uploaded.
pause
exit /b 1
