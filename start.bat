@echo off
REM ╔══════════════════════════════════════════════════════════╗
REM ║          Market Cockpit — One-Click Launcher             ║
REM ║          Windows                                         ║
REM ╚══════════════════════════════════════════════════════════╝

setlocal EnableDelayedExpansion

echo.
echo ==========================================
echo    ^>^>  Market Cockpit  Starting...
echo ==========================================
echo.

REM ── Step 1: Check Docker ─────────────────────────────────────────────────────
echo [1/5] Checking Docker...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Docker is not running.
    echo.
    echo  Please:
    echo    1. Install Docker Desktop from https://www.docker.com/products/docker-desktop/
    echo    2. Open Docker Desktop and wait for it to show "Running"
    echo    3. Run this script again
    echo.
    start https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)
echo   OK - Docker is running

REM ── Step 2: Check env file ────────────────────────────────────────────────────
echo [2/5] Checking configuration...
cd /d "%~dp0"

if not exist ".env" (
    if exist ".env.example" (
        copy .env.example .env >nul
        echo   OK - Created .env from template
    ) else (
        (
            echo # Market Cockpit Environment
            echo POSTGRES_DB=marketcockpit
            echo POSTGRES_USER=mcuser
            echo POSTGRES_PASSWORD=mcpassword123
            echo DATABASE_URL=postgresql+asyncpg://mcuser:mcpassword123@postgres:5432/marketcockpit
            echo REDIS_URL=redis://redis:6379/0
            echo SECRET_KEY=change-me-in-production-use-openssl-rand-hex-32
            echo ANTHROPIC_API_KEY=your-anthropic-api-key-here
            echo NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
        ) > .env
        echo   OK - Created default .env configuration
        echo.
        echo   OPTIONAL: Add your Anthropic API key to .env for AI features
        echo   Open .env with Notepad and set ANTHROPIC_API_KEY
        echo.
        timeout /t 3 /nobreak >nul
    )
) else (
    echo   OK - Configuration found
)

REM ── Step 3: Build images ─────────────────────────────────────────────────────
echo [3/5] Building Market Cockpit (first run takes 3-5 minutes)...
docker compose build --quiet
if %errorlevel% neq 0 (
    echo ERROR: Build failed. See above for details.
    pause
    exit /b 1
)
echo   OK - Build complete

REM ── Step 4: Start services ────────────────────────────────────────────────────
echo [4/5] Starting all services...
docker compose up -d --remove-orphans
if %errorlevel% neq 0 (
    echo ERROR: Failed to start services.
    pause
    exit /b 1
)
echo   OK - Services started

REM ── Step 5: Wait for ready ────────────────────────────────────────────────────
echo [5/5] Waiting for Market Cockpit to be ready...
set /a WAIT=0
:waitloop
if %WAIT% geq 90 goto waitdone
timeout /t 3 /nobreak >nul
curl -sf http://localhost:8000/health >nul 2>&1
if %errorlevel% equ 0 goto waitdone
set /a WAIT=WAIT+3
set /p "=." <nul
goto waitloop
:waitdone
echo.

REM ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo ==========================================
echo    Market Cockpit is LIVE!
echo ==========================================
echo.
echo    Open your browser: http://localhost:3000
echo.
echo    To stop: run stop.bat
echo    Logs:    docker compose logs -f
echo.

REM Open browser automatically
timeout /t 2 /nobreak >nul
start http://localhost:3000

pause
