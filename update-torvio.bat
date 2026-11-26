@echo off
REM Double-click to pull the latest fixes and rebuild. Keeps your account + data.
cd /d "%~dp0"
where git >nul 2>&1 || (echo Git is required: https://git-scm.com/download/win & pause & exit /b 1)
echo Pulling latest updates ...
git pull
echo Rebuilding and restarting the app (a minute or two) ...
docker compose up -d --build api worker web practice
echo.
echo Done. Refresh the Torv.io app (Ctrl+F5).
pause
