@echo off
REM Double-click to start FormAgent on this PC. Requires Docker Desktop.
cd /d "%~dp0"
where docker >nul 2>&1 || (echo Docker Desktop is required: https://docs.docker.com/get-docker/ & pause & exit /b 1)
if not exist .env (
  echo Generating local secrets .env ...
  docker run --rm -v "%cd%:/w" -w /w alpine sh -c "apk add --no-cache openssl >/dev/null 2>&1 && sh scripts/dev-secrets.sh" > .env
)
echo Starting database and cache ...
docker compose up -d postgres redis
echo Applying database schema ...
docker compose run --rm migrate
echo Building and starting the app (first run can take a few minutes) ...
docker compose up -d --build api worker web practice
echo Waiting for the app ...
timeout /t 25 >nul
start http://localhost:3000
echo.
echo FormAgent is running at http://localhost:3000
echo Admin email:    admin@formagent.local
for /f "tokens=2 delims==" %%p in ('findstr /b BOOTSTRAP_ADMIN_PASSWORD .env') do echo Admin password: %%p
echo.
pause
