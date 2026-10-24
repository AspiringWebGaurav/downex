@echo off
setlocal EnableDelayedExpansion
title Downex - Install Native Messaging Host

set "SCRIPT_DIR=%~dp0"
set "MANIFEST_PATH=%SCRIPT_DIR%com.downex.host.json"
set "TARGET_EXE=%SCRIPT_DIR%..\src-tauri\target\release\Downex.exe"

if not exist "%TARGET_EXE%" (
    if exist "%SCRIPT_DIR%..\src-tauri\target\debug\Downex.exe" (
        set "TARGET_EXE=%SCRIPT_DIR%..\src-tauri\target\debug\Downex.exe"
    ) else if exist "%LOCALAPPDATA%\Programs\Downex\Downex.exe" (
        set "TARGET_EXE=%LOCALAPPDATA%\Programs\Downex\Downex.exe"
    ) else if exist "%ProgramFiles%\Downex\Downex.exe" (
        set "TARGET_EXE=%ProgramFiles%\Downex\Downex.exe"
    )
)

for %%F in ("%TARGET_EXE%") do set "FULL_EXE=%%~fF"
set "ESCAPED_EXE=%FULL_EXE:\=\\%"

echo [Downex] Updating %MANIFEST_PATH% with target: %FULL_EXE%
(
  echo {
  echo   "name": "com.downex.host",
  echo   "description": "Downex Download Accelerator Native Host Bridge",
  echo   "path": "%ESCAPED_EXE%",
  echo   "type": "stdio",
  echo   "allowed_origins": [
  echo     "chrome-extension://*/*"
  echo   ]
  echo }
) > "%MANIFEST_PATH%"

echo [Downex] Registering Native Messaging Host for Chrome and Edge...
echo Manifest: %MANIFEST_PATH%

:: Register for Google Chrome
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.downex.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
if %errorlevel% equ 0 (
    echo [OK] Registered for Google Chrome
) else (
    echo [ERR] Failed to register for Google Chrome
)

:: Register for Microsoft Edge
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.downex.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
if %errorlevel% equ 0 (
    echo [OK] Registered for Microsoft Edge
) else (
    echo [ERR] Failed to register for Microsoft Edge
)

:: Register for Brave
reg add "HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.downex.host" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul
if %errorlevel% equ 0 (
    echo [OK] Registered for Brave Browser
)

echo.
echo [Downex] Setup complete!
echo You can now load the extension from:
echo   %SCRIPT_DIR%
echo into chrome://extensions or edge://extensions (Enable Developer Mode -^> Load unpacked)
echo.
pause
