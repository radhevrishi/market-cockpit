@echo off
REM ╔══════════════════════════════════════════════════════════╗
REM ║          Market Cockpit — Stop (Windows)                 ║
REM ╚══════════════════════════════════════════════════════════╝

echo.
echo Stopping Market Cockpit...
echo.

cd /d "%~dp0"

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not running - nothing to stop.
    pause
    exit /b 0
)

docker compose down --remove-orphans

echo.
echo Market Cockpit stopped.
echo Your data is saved. Run start.bat to start again.
echo.
pause
