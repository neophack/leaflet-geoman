@echo off
setlocal EnableDelayedExpansion
title Leaflet-Geoman Feature Demo
cd /d "%~dp0"

echo ============================================
echo   Leaflet-Geoman Feature Demo
echo   Usage: demo-feature.bat              single run, opens a browser
echo          demo-feature.bat loop         loop until a check fails
echo          demo-feature.bat --headless   run without a visible browser
echo ============================================
echo.

rem ---- check the dev server on port 5500 ----
set "DEMO_OK=1"
curl -s -o nul -m 2 http://127.0.0.1:5500/demo/ >nul 2>nul
if errorlevel 1 set "DEMO_OK=0"

if "%DEMO_OK%"=="0" (
    echo [INFO] dev server not running on 127.0.0.1:5500 - starting it in background...
    start "geoman-dev-server" /min cmd /c "cd /d "%~dp0" && set DEV=true&& node bundle.mjs"
    set /a WAITED=0
    :waitloop
    curl -s -o nul -m 2 http://127.0.0.1:5500/demo/ >nul 2>nul
    if not errorlevel 1 goto ready
    set /a WAITED+=1
    if !WAITED! GEQ 30 (
        echo [ERROR] server did not start. Run it manually: pnpm dev
        exit /b 1
    )
    timeout /t 1 /nobreak >nul
    goto waitloop
)
:ready
echo [OK] server ready: http://127.0.0.1:5500/demo/
echo.

rem ---- run the demo, forward all args ----
node demo/feature-demo.mjs %*
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
    echo [OK] demo finished, all checks passed.
) else (
    echo [FAIL] demo finished with failures, exit code %EXITCODE%.
)
if defined CI exit /b %EXITCODE%
pause
exit /b %EXITCODE%
