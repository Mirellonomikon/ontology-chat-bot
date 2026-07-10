#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Start all services for the Ontology Chatbot project.

.DESCRIPTION
    Launches three processes:
      - kg-service         (http://localhost:8001)  KG ingestion + RDF store
      - chatbot-server     (http://localhost:8000)
      - chatbot-ui         (http://localhost:5173)

    If Windows Terminal (wt) is available, all services open as tabs in the
    same terminal window. Otherwise each service gets its own window.

    All Python services share a single virtual environment at the project root.
    Node modules are installed automatically if node_modules is missing.

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
Write-Host "   Ontology Chatbot — Starting All Services" -ForegroundColor Yellow
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
# Launch each service
# ---------------------------------------------------------------------------

$services = @(
    @{
        Title = "kg-service (port 8001)"
        Dir   = Join-Path $Root "kg-service"
        Cmd   = "& '$UvicornExe' main:app --host 0.0.0.0 --port 8001"
    },
    @{
        Title = "chatbot-server (port 8000)"
        Dir   = Join-Path $Root "chatbot-server"
        Cmd   = "& '$UvicornExe' main:app --host 0.0.0.0 --port 8000 --reload"
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

    # Encode each pwsh command as Base64 so semicolons inside the shell
    # commands are never misinterpreted as Windows Terminal command separators.
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
Write-Host "  All services launched." -ForegroundColor Green
Write-Host ""
Write-Host "  KG Service      http://localhost:8001/docs" -ForegroundColor White
Write-Host "  Chatbot API     http://localhost:8000/docs" -ForegroundColor White
Write-Host "  Frontend        http://localhost:5173" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Close each tab/window (or press Ctrl+C inside it) to stop a service." -ForegroundColor DarkGray
Write-Host ""
