@echo off
REM One-click dev:web starter for D:\opencut-classic on a sandboxed drive
REM that blocks symlinks/junctions/hardlinks.
REM
REM Usage: dev-web.bat
REM Prereq: bun in PATH (e.g. installed with `npm install -g bun`).
REM Note: bun install will emit EPERM for the workspace package itself
REM ("failed linking dependency/workspace to node_modules for package opencut").
REM That is harmless on the sandboxed drive - Next.js only needs apps/web
REM linked under node_modules\@opencut\web, which the copy step below handles.

setlocal

set "ROOT=%~dp0"
set "APPS_WEB=%ROOT%apps\web"
set "WORKSPACE_LINK=%ROOT%node_modules\@opencut\web"

REM 1. Install deps (skips already-installed packages). Workspace link EPERM
REM    is non-fatal here - we patch the apps/web link manually below.
echo === Installing deps ===
bun install --linker=hoisted
if errorlevel 1 (
    echo.
    echo !!! bun install reported errors. Check messages above before continuing.
    echo !!! Workspace link failures are expected on sandboxed drives and are patched below.
)

REM 2. Work around the sandboxed drive's symlink ban.
REM    bun can't link the apps/web workspace into node_modules/@opencut/web.
REM    Copying the directory is enough for Next.js to resolve the package.
if not exist "%ROOT%node_modules" mkdir "%ROOT%node_modules"
if not exist "%ROOT%node_modules\@opencut" mkdir "%ROOT%node_modules\@opencut"
if exist "%APPS_WEB%\package.json" (
    if not exist "%WORKSPACE_LINK%\package.json" (
        echo === Linking apps/web into node_modules\@opencut\web ===
        xcopy /E /I /Y "%APPS_WEB%" "%WORKSPACE_LINK%" >nul
    ) else (
        echo === Workspace link already present - skipping copy ===
    )
)

REM 3. Ensure .env.local exists.
if not exist "%APPS_WEB%\.env.local" (
    if exist "%APPS_WEB%\.env.example" (
        echo === Creating .env.local from .env.example ===
        copy /Y "%APPS_WEB%\.env.example" "%APPS_WEB%\.env.local" >nul
    )
)

REM 4. Start Next.js dev server (bypasses turbo which the sandbox also blocks).
echo === Starting Next.js dev on http://localhost:3000 ===
cd /d "%APPS_WEB%"
bunx next dev --turbopack --port 3000
goto :eof