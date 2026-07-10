#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Start all services with DEBUG logging enabled.

.DESCRIPTION
    Same as start-chatbot.ps1, but sets LOG_LEVEL=DEBUG in each Python
    service process so verbose request/response traces appear in the console.

    Useful for debugging KG pipeline calls, SPARQL queries, provider
    communication, and context truncation.

.PARAMETER SkipInstall
    Skip dependency installation (useful when everything is already installed).
#>
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root        = $PSScriptRoot
$VenvDir     = Join-Path $Root ".venv"
$VenvScripts = Join-Path $VenvDir "Scripts"
$PipExe      = Join-Path $VenvScripts "pip.exe"
$UvicornExe  = Join-Path $VenvScripts "uvicorn.exe"

# Resolve the real pwsh.exe once. Passing a bare "pwsh" to Windows Terminal
# lets *wt* resolve it, and it can land on the 0-byte WindowsApps execution
# alias -> CreateProcess fails with 0x80070002. A full path sidesteps that.
$PwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $PwshExe) { $PwshExe = Join-Path $env:ProgramFiles "PowerShell\7\pwsh.exe" }

# Node's install dir isn't reliably inherited by the spawned tabs (npm ends up
# "not recognized"), so resolve it here and prepend it to PATH inside each tab.
$NodeDir = (Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source
$NodeDir = if ($NodeDir) { Split-Path -Parent $NodeDir } else { Join-Path $env:ProgramFiles "nodejs" }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "  >> $msg" -ForegroundColor Cyan
}

function Ensure-SharedVenv {
    if (-not (Test-Path $VenvDir)) {
        Write-Step "Creating shared venv at project root"
        python -m venv $VenvDir
    }
}

function Install-AllPyDeps {
    $reqs = Join-Path $Root "requirements.txt"
    Write-Step "Installing Python deps from root requirements.txt"
    & $PipExe install -r $reqs --quiet
}

# ---------------------------------------------------------------------------
# Validate root
# ---------------------------------------------------------------------------

foreach ($dir in @("kg-service", "chatbot-server", "chatbot-ui")) {
    if (-not (Test-Path (Join-Path $Root $dir))) {
        Write-Error "Expected sub-directory '$dir' not found under $Root"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "   Ontology Chatbot — DEBUG LOGGING MODE" -ForegroundColor Yellow
Write-Host "   LOG_LEVEL=DEBUG enabled for all services" -ForegroundColor DarkYellow
Write-Host "========================================" -ForegroundColor Yellow

# ---------------------------------------------------------------------------
# Copy .env files if missing
# ---------------------------------------------------------------------------

foreach ($svc in @("kg-service", "chatbot-server")) {
    $envFile    = Join-Path $Root "$svc\.env"
    $envExample = Join-Path $Root "$svc\.env.example"
    if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
        Write-Step "Copying .env.example -> .env for $svc"
        Copy-Item $envExample $envFile
    }
}

# ---------------------------------------------------------------------------
# Install / update dependencies (unless -SkipInstall)
# ---------------------------------------------------------------------------

if (-not $SkipInstall) {
    Ensure-SharedVenv
    Install-AllPyDeps

    $uiDir = Join-Path $Root "chatbot-ui"
    if (-not (Test-Path (Join-Path $uiDir "node_modules"))) {
        Write-Step "Installing Node deps in chatbot-ui"
        Push-Location $uiDir
        npm install --silent
        Pop-Location
    }
} else {
    Write-Step "Skipping dependency installation (-SkipInstall flag set)"
}

# ---------------------------------------------------------------------------
# Launch each service (LOG_LEVEL=DEBUG injected into Python service processes)
# ---------------------------------------------------------------------------

$services = @(
    @{
        Title = "kg-service [DEBUG] (port 8001)"
        Dir   = Join-Path $Root "kg-service"
        Cmd   = "`$env:LOG_LEVEL='DEBUG'; & '$UvicornExe' main:app --host 0.0.0.0 --port 8001 --log-level debug"
    },
    @{
        Title = "chatbot-server [DEBUG] (port 8000)"
        Dir   = Join-Path $Root "chatbot-server"
        Cmd   = "`$env:LOG_LEVEL='DEBUG'; & '$UvicornExe' main:app --host 0.0.0.0 --port 8000 --reload --log-level debug"
    },
    @{
        Title = "chatbot-ui (port 5173)"
        Dir   = Join-Path $Root "chatbot-ui"
        Cmd   = "npm run dev"
    }
)

$wtAvailable = $null -ne (Get-Command wt -ErrorAction SilentlyContinue)

if ($wtAvailable) {
    Write-Step "Opening services as tabs in Windows Terminal"

    $wtParts = @()
    $first = $true
    foreach ($svc in $services) {
        $innerCmd = "`$env:Path = '$NodeDir;' + `$env:Path; Set-Location '$($svc.Dir)'; `$host.UI.RawUI.WindowTitle = '$($svc.Title)'; $($svc.Cmd)"
        $encoded  = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($innerCmd))
        $tabCmd   = "new-tab --title `"$($svc.Title)`" -- `"$PwshExe`" -NoExit -EncodedCommand $encoded"
        if ($first) {
            $wtParts += $tabCmd
            $first = $false
        } else {
            $wtParts += "; $tabCmd"
        }
    }

    Start-Process wt -ArgumentList ($wtParts -join " ")
} else {
    Write-Step "Windows Terminal not found — opening services in separate windows"
    foreach ($svc in $services) {
        $innerCmd = "`$env:Path = '$NodeDir;' + `$env:Path; Set-Location '$($svc.Dir)'; `$host.UI.RawUI.WindowTitle = '$($svc.Title)'; $($svc.Cmd)"
        Start-Process $PwshExe -ArgumentList @("-NoExit", "-Command", $innerCmd) -WindowStyle Normal
        Start-Sleep -Milliseconds 500
    }
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  All services launched in DEBUG mode." -ForegroundColor Green
Write-Host ""
Write-Host "  KG Service      http://localhost:8001/docs" -ForegroundColor White
Write-Host "  Chatbot API     http://localhost:8000/docs" -ForegroundColor White
Write-Host "  Frontend        http://localhost:5173" -ForegroundColor White
Write-Host ""
Write-Host "  Watch the kg-service tab for ingestion and SPARQL logs." -ForegroundColor DarkGray
Write-Host "  Watch the chatbot-server tab for KG pipeline and provider logs." -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Close each tab/window (or press Ctrl+C inside it) to stop a service." -ForegroundColor DarkGray
Write-Host ""
