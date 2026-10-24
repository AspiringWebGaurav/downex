<#
.SYNOPSIS
    Downex Project Vault Decryptor (PowerShell Launcher)
.DESCRIPTION
    Decrypts downex-vault.enc into the local project tree using scripts/vault.mjs unpack.
    Supports interactive password entry, environment variable, or -Password parameter.
.EXAMPLE
    .\scripts\decrypt-vault.ps1
    .\scripts\decrypt-vault.ps1 -Password "<your_passphrase>"
#>
param (
    [string]$Password = $env:DOWNEX_VAULT_PASS,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Set-Location $ProjectRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "Node.js is required to decrypt the Downex Project Vault. Please install Node.js."
    exit 1
}

$VaultFile = Join-Path $ProjectRoot "downex-vault.enc"
if (-not (Test-Path $VaultFile)) {
    $VaultFile = Join-Path $ProjectRoot "vault\vault.bin"
}
if (-not (Test-Path $VaultFile)) {
    Write-Error "Vault file not found at '$VaultFile'. Make sure the repository is fully cloned."
    exit 1
}

$NodeArgs = @("scripts/vault.mjs", "unpack")

if ($Password) {
    $NodeArgs += "--pass"
    $NodeArgs += $Password
}

& node @NodeArgs
exit $LASTEXITCODE
