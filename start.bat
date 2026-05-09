@echo off
chcp 932 > nul
title Kondate App

cd /d %~dp0

echo ========================================
echo   Kondate App - Starting...
echo ========================================
echo.

:: Check Python
python --version > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Please install Python 3.9+.
    pause
    exit /b 1
)

:: Kill any existing process on port 8000
echo Checking port 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " ^| findstr "LISTENING" 2^>nul') do (
    echo   Stopping previous server (PID: %%a)...
    taskkill /f /pid %%a > nul 2>&1
)
echo   Port 8000 is ready.
echo.

:: Switch to UTF-8 after the for/f loop (avoids Windows cmd bug with chcp 65001 + pipes)
chcp 65001 > nul
set PYTHONUTF8=1

echo [1/4] Installing packages...
pip install -r backend\requirements.txt -q
if errorlevel 1 (
    echo [ERROR] Package installation failed.
    pause
    exit /b 1
)
echo      Done.

echo [2/4] Setting up VAPID keys...
python setup_vapid.py
echo.

echo [3/4] Generating icons...
python generate_icons.py -q 2>nul
echo      Done.

echo [4/4] Starting server...
echo.
echo ----------------------------------------
echo  App URL   : http://localhost:8000
echo  Smartphone: http://[Your PC IP]:8000
echo  API Docs  : http://localhost:8000/docs
echo.
echo  Press Ctrl+C to stop.
echo ----------------------------------------
echo.

cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

cd ..
pause
