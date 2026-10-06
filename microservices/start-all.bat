@echo off
REM ──────────────────────────────────────────────────────────────
REM  Kaveri Advisory — Start All Microservices
REM  Run this from the project root directory.
REM ──────────────────────────────────────────────────────────────

echo.
echo ============================================================
echo   Kaveri Advisory - Microservices Launcher
echo ============================================================
echo.

REM ── 1. Weather Service (Node.js, port 4001) ──
echo [1/4] Starting Weather Service on port 4001...
cd /d "%~dp0weather-service"
start "Weather Service (4001)" cmd /k "npm start"
timeout /t 2 >nul

REM ── 2. Advisory Service (Python/Flask, port 4002) ──
echo [2/4] Starting Advisory Service on port 4002...
cd /d "%~dp0advisory-service"
start "Advisory Service (4002)" cmd /k "python app.py"
timeout /t 2 >nul

REM ── 3. Notification Service (Node.js, port 4003) ──
echo [3/4] Starting Notification Service on port 4003...
cd /d "%~dp0notification-service"
start "Notification Service (4003)" cmd /k "npm start"
timeout /t 2 >nul

REM ── 4. API Gateway (Node.js, port 4000) ──
echo [4/4] Starting API Gateway on port 4000...
cd /d "%~dp0api-gateway"
start "API Gateway (4000)" cmd /k "npm start"
timeout /t 2 >nul

echo.
echo ============================================================
echo   All services started!
echo.
echo   API Gateway:          http://localhost:4000
echo   Weather Service:      http://localhost:4001
echo   Advisory Service:     http://localhost:4002
echo   Notification Service: http://localhost:4003
echo.
echo   Health Check:  http://localhost:4000/api/health
echo   Gateway Info:  http://localhost:4000/api/info
echo.
echo   Open the frontend dashboard at:
echo   http://localhost:4000 (or open dashboard.html directly)
echo ============================================================
echo.
pause
