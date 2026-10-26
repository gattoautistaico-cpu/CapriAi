# CYBER AI - build locale su Windows (dopo setup.ps1 -> sezione 4)
Set-Location (Split-Path $PSScriptRoot -Parent)
# 'Continue': npm/cargo scrivono avvisi su stderr che PowerShell 5 tratterebbe come errori fatali
$ErrorActionPreference = 'Continue'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + "$env:USERPROFILE\.cargo\bin"

function Step($t) { Write-Host "/// $t" -ForegroundColor Yellow }
function Need($c) { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Write-Host "MANCA: $c (esegui install.bat, sezione 4)" -ForegroundColor Red; exit 2 } }

Step 'versioni'
foreach ($c in 'node', 'npm', 'cargo', 'rustc') { Need $c }
node --version; npm --version; rustc --version; cargo --version
rustup show active-toolchain 2>&1

Step 'npm install'
npm install --no-audit --no-fund 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Write-Host "npm install fallito ($LASTEXITCODE)" -ForegroundColor Red; exit 3 }

Step 'tauri build (prima volta: 5-15 minuti)'
npm run tauri build 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Write-Host "tauri build fallito ($LASTEXITCODE)" -ForegroundColor Red; exit 4 }

$out = Get-ChildItem 'src-tauri\target\release\bundle\nsis\*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
New-Item -ItemType Directory -Force -Path 'release' | Out-Null
if ($out) { Copy-Item $out.FullName 'release\' -Force }
Copy-Item 'src-tauri\target\release\cyber-ai.exe' 'release\CyberAI-portable.exe' -Force
Step "FATTO: release\$($out.Name) + release\CyberAI-portable.exe"
exit 0
