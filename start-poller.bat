@echo off
setlocal
title MMX Poller
cd /d "%~dp0"

if not exist "build\standalone.js" (
    echo [start-poller] build\standalone.js not found - running build first...
    call npm run build
    if errorlevel 1 (
        echo [start-poller] BUILD FAILED. See output above.
        pause
        exit /b 1
    )
)

echo.
echo ============================================================
echo   MMX Poller starting
echo   Dashboard:   http://localhost:3000
echo   Error log:   poller.log  (stderr only)
echo   Press Ctrl+C in this window to stop.
echo ============================================================
echo.

echo [%date% %time%] start-poller.bat launched >> poller.log
node build\standalone.js 2>> poller.log

echo.
echo [start-poller] Poller exited with code %errorlevel%.
pause
