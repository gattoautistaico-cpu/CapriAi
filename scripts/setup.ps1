# =====================================================================
#  CYBER AI - installazione guidata prerequisiti (Windows 10/11)
#  Target: AMD RX 6600 8GB / i5 9a gen / 32GB RAM
#  Uso:  tasto destro -> "Esegui con PowerShell"  oppure  install.bat
# =====================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # download molto piu' veloci
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Tools  = Join-Path $env:LOCALAPPDATA 'CyberAI\tools'
$Models = Join-Path $Tools 'models'
$Voices = Join-Path $Tools 'voices'
New-Item -ItemType Directory -Force -Path $Tools, $Models, $Voices | Out-Null

function Title($t) { Write-Host ''; Write-Host "///  $t  ///" -ForegroundColor Yellow }
function Ok($t)    { Write-Host "  [OK] $t" -ForegroundColor Green }
function Info($t)  { Write-Host "  ... $t" -ForegroundColor Cyan }
function Warn($t)  { Write-Host "  [!] $t" -ForegroundColor Red }
function Ask($q, $def = 's') {
  $a = Read-Host "  $q [$def]"
  if ([string]::IsNullOrWhiteSpace($a)) { $a = $def }
  return $a.Trim().ToLower().StartsWith('s') -or $a.Trim().ToLower().StartsWith('y')
}
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

function Winget($id, $extra = '') {
  if (-not (Has 'winget')) { Warn "winget non trovato: installa 'App Installer' dal Microsoft Store"; return }
  Info "winget install $id"
  $wargs = @('install', '--id', $id, '-e', '--accept-source-agreements', '--accept-package-agreements', '--silent')
  if ($extra) { $wargs += @('--override', $extra) }
  & winget @wargs
  if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189) { Ok "$id installato" } else { Warn "${id}: codice $LASTEXITCODE (forse gia' installato)" }
}

function Download($url, $dest) {
  if (Test-Path $dest) { Ok "gia' presente: $(Split-Path $dest -Leaf)"; return }
  Info "download $(Split-Path $dest -Leaf)"
  $tmp = "$dest.part"
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -Headers @{ 'User-Agent' = 'CyberAI-setup' }
  Move-Item $tmp $dest -Force
  Ok "scaricato $(Split-Path $dest -Leaf)"
}

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

Clear-Host
Write-Host '   ____      _                 _    ___ ' -ForegroundColor Yellow
Write-Host '  / ___|   _| |__   ___ _ __  / \  |_ _|' -ForegroundColor Yellow
Write-Host ' | |  | | | |  _ \ / _ \  __|/ _ \  | | ' -ForegroundColor Yellow
Write-Host ' | |__| |_| | |_) |  __/ |  / ___ \ | | ' -ForegroundColor Yellow
Write-Host '  \____\__, |_.__/ \___|_| /_/   \_\___|' -ForegroundColor Yellow
Write-Host '       |___/   setup prerequisiti' -ForegroundColor Red
Write-Host "  Strumenti in: $Tools" -ForegroundColor DarkGray

# ------------------------------------------------------------------ GPU
Title 'CONTROLLO HARDWARE'
$gpu = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name
$ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
Ok "GPU: $gpu"
Ok "RAM: $ram GB"
if ($gpu -match 'RX 6600') { Info 'RX 6600: ROCm Windows non supportato -> si usa Vulkan (Ollama/LM Studio). Driver AMD Adrenalin aggiornato consigliato.' }

# ------------------------------------------------------------------ LLM
Title '1/4  MOTORE LLM LOCALE'
Write-Host '  [1] Ollama  (consigliato, Vulkan su RX 6600)'
Write-Host '  [2] LM Studio (GUI, runtime Vulkan llama.cpp)'
Write-Host '  [3] Salta'
$llm = Read-Host '  Scelta [1]'
if (-not $llm) { $llm = '1' }

if ($llm -eq '1') {
  if (-not (Has 'ollama')) { Winget 'Ollama.Ollama'; Refresh-Path } else { Ok 'Ollama gia installato' }
  # Limiti VRAM: un modello alla volta, contesto 4096, KV cache q8 (sta sotto ~6.5 GB)
  $envs = @{
    OLLAMA_MAX_LOADED_MODELS = '1'
    OLLAMA_NUM_PARALLEL      = '1'
    OLLAMA_CONTEXT_LENGTH    = '4096'
    OLLAMA_FLASH_ATTENTION   = '1'
    OLLAMA_KV_CACHE_TYPE     = 'q8_0'
    OLLAMA_KEEP_ALIVE        = '15m'
    OLLAMA_ORIGINS           = '*'
  }
  foreach ($k in $envs.Keys) { [Environment]::SetEnvironmentVariable($k, $envs[$k], 'User'); Set-Item "env:$k" $envs[$k] }
  Ok 'variabili Ollama impostate (riavvia Ollama dal tray per applicarle)'

  Write-Host ''
  Write-Host '  Pacchetto modelli:'
  Write-Host '  [1] LEGGERO   gemma3:4b (chat + visione in un solo modello, ~3.3 GB VRAM)'
  Write-Host '  [2] QUALITA   qwen2.5:7b (chat, ~4.7 GB) + moondream (visione, ~1.7 GB, caricato a turno)'
  Write-Host '  [3] ENTRAMBI'
  Write-Host '  [4] Salta'
  $pk = Read-Host '  Scelta [1]'
  if (-not $pk) { $pk = '1' }
  $list = switch ($pk) { '1' { @('gemma3:4b') } '2' { @('qwen2.5:7b', 'moondream') } '3' { @('gemma3:4b', 'qwen2.5:7b', 'moondream') } default { @() } }
  if ($list.Count -gt 0) {
    Info 'avvio servizio Ollama'
    Start-Process 'ollama' -ArgumentList 'serve' -WindowStyle Hidden -ErrorAction SilentlyContinue
    Start-Sleep 4
    foreach ($m in $list) { Info "ollama pull $m"; & ollama pull $m }
    Ok 'modelli scaricati'
    if ($pk -eq '1') { Info "Nell'app: AI locale -> chat = gemma3:4b, visione = gemma3:4b" }
  }
} elseif ($llm -eq '2') {
  Winget 'ElementLabs.LMStudio'
  Info 'In LM Studio: Settings > Runtime > Vulkan llama.cpp. Scarica "Qwen2.5 7B Instruct Q4_K_M" e un VLM (gemma-3-4b). Avvia il server (porta 1234).'
  Info "Nell'app: AI locale -> pulsante 'LM Studio'"
}

# ------------------------------------------------------------------ STT
Title '2/4  WHISPER.CPP (speech-to-text, gira su CPU: zero VRAM)'
if (Ask 'Installare whisper.cpp?') {
  $wdir = Join-Path $Tools 'whisper'
  if (-not (Test-Path (Join-Path $wdir 'whisper-server.exe'))) {
    $rel = Invoke-RestMethod 'https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest' -Headers @{ 'User-Agent' = 'CyberAI-setup' }
    $asset = $rel.assets | Where-Object { $_.name -eq 'whisper-bin-x64.zip' } | Select-Object -First 1
    if (-not $asset) { $asset = $rel.assets | Where-Object { $_.name -match 'bin-x64\.zip$' -and $_.name -notmatch 'cublas|cuda' } | Select-Object -First 1 }
    if (-not $asset) { Warn 'asset Windows non trovato nella release, scaricalo a mano da github.com/ggml-org/whisper.cpp/releases' }
    else {
      $zip = Join-Path $env:TEMP $asset.name
      Download $asset.browser_download_url $zip
      $x = Join-Path $env:TEMP 'cyberai_whisper'
      if (Test-Path $x) { Remove-Item $x -Recurse -Force }
      Expand-Archive $zip $x -Force
      $srv = Get-ChildItem $x -Recurse -Filter 'whisper-server.exe' | Select-Object -First 1
      if (-not $srv) { $srv = Get-ChildItem $x -Recurse -Filter 'server.exe' | Select-Object -First 1 }
      New-Item -ItemType Directory -Force -Path $wdir | Out-Null
      Copy-Item (Join-Path $srv.DirectoryName '*') $wdir -Recurse -Force
      if ($srv.Name -eq 'server.exe') { Copy-Item (Join-Path $wdir 'server.exe') (Join-Path $wdir 'whisper-server.exe') }
      Ok "whisper.cpp $($rel.tag_name) in $wdir"
    }
  } else { Ok 'whisper-server gia presente' }

  Write-Host '  Modello: [1] small (466 MB, consigliato i5 9a gen)  [2] medium q5_0 (515 MB, piu preciso, piu lento)  [3] entrambi'
  $wm = Read-Host '  Scelta [1]'
  if (-not $wm) { $wm = '1' }
  $hf = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
  if ($wm -in '1', '3') { Download "$hf/ggml-small.bin" (Join-Path $Models 'ggml-small.bin') }
  if ($wm -in '2', '3') { Download "$hf/ggml-medium-q5_0.bin" (Join-Path $Models 'ggml-medium-q5_0.bin') }
}

# ------------------------------------------------------------------ TTS
Title '3/4  PIPER TTS (voce locale, CPU)'
if (Ask 'Installare Piper + voci femminili?') {
  $pdir = Join-Path $Tools 'piper'
  if (-not (Test-Path (Join-Path $pdir 'piper.exe'))) {
    $zip = Join-Path $env:TEMP 'piper_windows_amd64.zip'
    Download 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' $zip
    $x = Join-Path $env:TEMP 'cyberai_piper'
    if (Test-Path $x) { Remove-Item $x -Recurse -Force }
    Expand-Archive $zip $x -Force
    $exe = Get-ChildItem $x -Recurse -Filter 'piper.exe' | Select-Object -First 1
    New-Item -ItemType Directory -Force -Path $pdir | Out-Null
    Copy-Item (Join-Path $exe.DirectoryName '*') $pdir -Recurse -Force
    Ok "Piper in $pdir"
  } else { Ok 'Piper gia presente' }
  $pv = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'
  $voicesList = @(
    @{ n = 'it_IT-paola-medium'; p = 'it/it_IT/paola/medium' },
    @{ n = 'en_US-amy-medium';   p = 'en/en_US/amy/medium' },
    @{ n = 'pl_PL-gosia-medium'; p = 'pl/pl_PL/gosia/medium' }
  )
  foreach ($v in $voicesList) {
    Download "$pv/$($v.p)/$($v.n).onnx" (Join-Path $Voices "$($v.n).onnx")
    Download "$pv/$($v.p)/$($v.n).onnx.json" (Join-Path $Voices "$($v.n).onnx.json")
  }
  Info 'Voce giapponese: Piper non ne ha una ufficiale -> usa voci Windows (Impostazioni > Lingua > giapponese) o ElevenLabs.'
}

# ------------------------------------------------------------------ DEV
Title '4/4  STRUMENTI DI SVILUPPO (solo per compilare l''app)'
if (Ask 'Installare Node.js, Rust e Visual Studio Build Tools?' 'n') {
  Winget 'Git.Git'
  Winget 'OpenJS.NodeJS.LTS'
  Winget 'Rustlang.Rustup'
  Winget 'Microsoft.VisualStudio.2022.BuildTools' '--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'
  Winget 'Microsoft.EdgeWebView2Runtime'
  Refresh-Path
  if (Has 'rustup') { & rustup default stable-msvc }
  Ok 'ambiente di build pronto: esegui scripts\build-windows.ps1'
}

Title 'FATTO'
Ok "Strumenti in $Tools (l'app li rileva da sola al primo avvio)"
Info 'Avvia Cyber AI: tasto destro sull''avatar o icona nel tray -> Impostazioni.'
Read-Host '  Premi INVIO per chiudere'
