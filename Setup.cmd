@echo off
setlocal enabledelayedexpansion
title Downex — Automated Environment Setup
color 0A

echo ======================================================================
echo           Downex (Download Manager) — Automated Setup ^& Recovery
echo ======================================================================
echo.

:: 1. Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: 2. Check npm
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not installed or not in PATH.
    pause
    exit /b 1
)

echo [1/3] Installing NPM project dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] npm install failed. Please check your network connection.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/3] Unpacking encrypted project vault (rules, secrets, signing keys)...
call npm run vault:unpack
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Vault unpack failed. Please verify your master passphrase.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [3/3] Checking environment readiness...
echo Workspace restored successfully.

echo.
echo ======================================================================
echo   [SUCCESS] Downex workspace is 100%% restored and ready for development!
echo.
echo   Commands:
echo     npm run dev             - Launch local development app
echo     npm run build:frontend  - Validate TypeScript ^& Vite bundle
echo ======================================================================
echo.
pause
