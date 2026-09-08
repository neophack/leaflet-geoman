@echo off
setlocal
rem Build script for leaflet-geoman dist (runs from its own folder)
cd /d "%~dp0"

echo ============================================
echo  leaflet-geoman v2.20.0  build dist
echo ============================================

rem Prefer pnpm for installing deps, fall back to npm. `where pnpm` only
rem confirms a shim exists on PATH - it doesn't confirm the shim actually
rem runs (a stale/corrupted global pnpm install still resolves via `where`
rem but fails on invocation), so actually invoke it before trusting it.
pnpm --version >nul 2>nul
if %errorlevel%==0 (
    set "PKG_RUNNER=pnpm"
    set "INSTALL_CMD=pnpm install"
) else (
    echo [WARN] pnpm was not usable ^(found on PATH but failed to run^) - falling back to npm.
    set "PKG_RUNNER=npm"
    set "INSTALL_CMD=npm install --ignore-scripts"
)

if not exist "node_modules" (
    echo [1/4] node_modules not found, installing deps: %INSTALL_CMD%
    call %INSTALL_CMD%
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        goto :fail
    )
) else (
    echo [1/4] Dependencies found, skip install.
)

echo [2/4] Building dist ...
call node bundle.mjs
if errorlevel 1 goto :fail

echo [3/4] Running unit tests (vitest) ...
call %PKG_RUNNER% run test:unit
if errorlevel 1 (
    echo [ERROR] Unit tests failed.
    goto :fail
)

echo [4/4] Running e2e tests (cypress) ...
call %PKG_RUNNER% exec cypress install
if errorlevel 1 (
    echo [ERROR] Failed to install Cypress binary.
    goto :fail
)
call %PKG_RUNNER% run test
if errorlevel 1 (
    echo [ERROR] E2E tests failed.
    goto :fail
)

echo.
echo Build succeeded. dist contents:
for %%F in ("%~dp0dist\*") do echo   %%~nxF
echo.
goto :end

:fail
echo.
echo [ERROR] Build failed!

:end
pause
endlocal
