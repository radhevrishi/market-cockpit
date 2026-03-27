@echo off
REM ═══════════════════════════════════════════════════════════
REM   Market Cockpit — Local Launcher (No Docker needed)
REM   Double-click this file to start the dashboard
REM ═══════════════════════════════════════════════════════════

setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo  ==========================================
echo    Market Cockpit - Starting Locally...
echo  ==========================================
echo.

REM ── Check Python ────────────────────────────────────────
echo [1/5] Checking prerequisites...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    python3 --version >nul 2>&1
    if %errorlevel% neq 0 (
        echo ERROR: Python not found. Install from https://python.org
        pause
        exit /b 1
    )
    set PYTHON=python3
) else (
    set PYTHON=python
)

node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
echo   OK - Python and Node.js found

REM ── Setup .env ──────────────────────────────────────────
echo [2/5] Setting up configuration...
if not exist "backend\.env" (
    (
        echo DATABASE_URL=sqlite+aiosqlite:///./market_cockpit.db
        echo REDIS_URL=redis://localhost:6379/0
        echo SECRET_KEY=market-cockpit-secret-key-change-in-production
        echo ANTHROPIC_API_KEY=
        echo ENVIRONMENT=development
        echo LOG_LEVEL=info
    ) > backend\.env
    echo   Created backend\.env with SQLite defaults
) else (
    echo   OK - backend\.env exists
)

if not exist "frontend\.env.local" (
    echo NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1> frontend\.env.local
    echo   Created frontend\.env.local
)

REM ── Backend setup ───────────────────────────────────────
echo [3/5] Setting up backend...
cd backend
if not exist "venv" (
    echo   Creating virtual environment...
    %PYTHON% -m venv venv
)
call venv\Scripts\activate.bat
pip install -q -r requirements.txt
echo   OK - Backend ready
cd ..

REM ── Frontend setup ──────────────────────────────────────
echo [4/5] Setting up frontend...
cd frontend
if not exist "node_modules" (
    echo   Installing npm packages (may take a minute)...
    npm install --legacy-peer-deps --silent
)
echo   OK - Frontend ready
cd ..

REM ── Start servers ───────────────────────────────────────
echo [5/5] Starting servers...

REM Start backend in background
cd backend
call venv\Scripts\activate.bat
start /B "Backend" cmd /c "uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload > ..\backend.log 2>&1"
echo   Backend starting on http://localhost:8000
cd ..

REM Wait for backend
timeout /t 5 /nobreak >nul

REM Start frontend in background
cd frontend
start /B "Frontend" cmd /c "npm run dev > ..\frontend.log 2>&1"
echo   Frontend starting on http://localhost:3000
cd ..

timeout /t 8 /nobreak >nul

echo.
echo  ==========================================
echo    Market Cockpit is LIVE!
echo  ==========================================
echo.
echo    Dashboard:  http://localhost:3000
echo    API Docs:   http://localhost:8000/docs
echo.
echo    Close this window to stop both servers
echo.

REM Open browser
start http://localhost:3000

REM Keep window open
echo Press Ctrl+C or close this window to stop...
pause >nul
