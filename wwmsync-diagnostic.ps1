[CmdletBinding()]
param(
  [string]$GameExe = '',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v5.json')
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native bridge diagnostic v5.
# Static/read-only reverse engineering only. No process-memory reads, injection,
# packet capture, active network probes, pipe connections/writes, registry writes,
# credential collection, or game-file modification.

$Needles = @(
  'wwm_launcher_server',
  'launcher_server',
  'find_self_pos',
  'quickLocate',
  'showPosition',
  'map_pos_ok',
  'map_pos_fail',
  'personalLink',
  'personal.html',
  'pcEntry',
  'call_client_method',
  'start_game_sync',
  'h72_map_accessToken',
  'point_finished',
  'CreateNamedPipe',
  'ConnectNamedPipe',
  'CallNamedPipe',
  'NamedPipe',
  'WebView',
  'UniSDK',
  'protocol'
)

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return $null }
  $s = [string]$Text
  if ($env:USERPROFILE) { $s = $s.Replace($env:USERPROFILE, '<USERPROFILE>') }
  if ($env:USERNAME) { $s = $s -replace [regex]::Escape($env:USERNAME), '<USER>' }
  $s = $s -replace '(?i)(token|ticket|session|password|passwd|secret|authorization)=\S+', '$1=<REDACTED>'
  $s = $s -replace '(?i)([?&](?:token|access_token|refresh_token|sessionid|ticket|code)=)[^&\s]+', '$1<REDACTED>'
  $s = $s -replace '[A-Fa-f0-9]{40,}', '<LONG_HEX>'
  $s = $s -replace '[A-Za-z0-9_-]{64,}', '<LONG_TOKEN>'
  return $s
}

function Write-Json($Object) {
  $parent = Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 12 | Set-Content -Path $OutputPath -Encoding UTF8
}

function Get-InstallRoot([string]$ExePath) {
  if ([string]::IsNullOrWhiteSpace($ExePath)) { return '' }
  $p = Split-Path -Parent $ExePath
  for ($i=0; $i -lt 3; $i++) { if ($p) { $p = Split-Path -Parent $p } }
  return $p
}

function Add-UniquePath($List,[string]$Path) {
  if (-not $Path) { return }
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  foreach ($existing in $List) { if ([string]$existing -ieq $Path) { return } }
  [void]$List.Add($Path)
}

function Get-CandidateFiles([string]$ExePath) {
  $out = New-Object System.Collections.ArrayList
  if (-not $ExePath) { return @() }
  $bin = Split-Path -Parent $ExePath
  $root = Get-InstallRoot $ExePath

  Add-UniquePath $out $ExePath
  foreach ($name in @(
    'launcher.exe','NtUniSdkProtocol.dll','NtUniSdkNgWebview.dll','webview_support_helper.dll',
    'UniWER.dll','NtUniSdkBase.dll','NtUniSdkRoost.dll','NtUniSdkRoostX.dll',
    'NtUniSdkOrbitX.dll','mpay.dll','mpay_oversea.dll','protocol.data','netease_global.data','netease.data'
  )) {
    Add-UniquePath $out (Join-Path $bin $name)
    if ($root) { Add-UniquePath $out (Join-Path $root $name) }
  }

  if ($root -and (Test-Path $root)) {
    foreach ($f in @(Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -match '(?i)^(launcher|wwm).*\.exe$' -or
      $_.Name -match '(?i)(unisdk.*(protocol|webview|roost|orbit)|webview_support|uniwer|mpay).*\.dll$'
    } | Select-Object -First 80)) {
      Add-UniquePath $out $f.FullName
    }
  }

  return @($out)
}

function Get-SafeAsciiContext([byte[]]$Bytes,[int]$Start,[int]$Length) {
  if ($Bytes.Length -eq 0) { return '' }
  $s = [Math]::Max(0,$Start)
  $e = [Math]::Min($Bytes.Length,$Start+$Length)
  if ($e -le $s) { return '' }
  $slice = New-Object byte[] ($e-$s)
  [Array]::Copy($Bytes,$s,$slice,0,$slice.Length)
  $text = [Text.Encoding]::ASCII.GetString($slice)
  $text = $text -replace '[^\x20-\x7E]', ' '
  $text = $text -replace '\s+', ' '
  return Protect-Text $text.Trim()
}

function Find-BytePattern([byte[]]$Haystack,[byte[]]$Needle,[int]$MaxHits=16) {
  $hits = @()
  if ($Needle.Length -eq 0 -or $Haystack.Length -lt $Needle.Length) { return $hits }
  for ($i=0; $i -le $Haystack.Length-$Needle.Length; $i++) {
    $ok = $true
    for ($j=0; $j -lt $Needle.Length; $j++) {
      if ($Haystack[$i+$j] -ne $Needle[$j]) { $ok=$false; break }
    }
    if ($ok) {
      $hits += $i
      if ($hits.Count -ge $MaxHits) { break }
      $i += [Math]::Max(0,$Needle.Length-1)
    }
  }
  return $hits
}

function Scan-File([string]$Path) {
  $item = Get-Item -LiteralPath $Path
  $result = [ordered]@{
    path = Protect-Text $Path
    name = $item.Name
    length = [int64]$item.Length
    sha256 = $null
    skipped = $false
    hits = @()
  }
  try { $result.sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash } catch {}

  # Keep local diagnostics bounded. Relevant WWM binaries in this install are below this cap.
  if ($item.Length -gt 134217728) { $result.skipped=$true; return $result }

  $bytes = $null
  try { $bytes = [IO.File]::ReadAllBytes($Path) } catch { $result.skipped=$true; return $result }
  foreach ($needle in $Needles) {
    $ascii = [Text.Encoding]::ASCII.GetBytes($needle)
    foreach ($offset in @(Find-BytePattern $bytes $ascii 12)) {
      $result.hits += [ordered]@{
        needle=$needle
        encoding='ascii'
        offset=[int64]$offset
        context=(Get-SafeAsciiContext $bytes ([Math]::Max(0,$offset-192)) ([Math]::Min(512,$bytes.Length-[Math]::Max(0,$offset-192))))
      }
    }

    $utf16 = [Text.Encoding]::Unicode.GetBytes($needle)
    foreach ($offset in @(Find-BytePattern $bytes $utf16 12)) {
      $start=[Math]::Max(0,$offset-256)
      $length=[Math]::Min(768,$bytes.Length-$start)
      $slice=New-Object byte[] $length
      [Array]::Copy($bytes,$start,$slice,0,$length)
      $text=[Text.Encoding]::Unicode.GetString($slice)
      $text=$text -replace '[^\x20-\x7E]', ' '
      $text=$text -replace '\s+', ' '
      $result.hits += [ordered]@{
        needle=$needle
        encoding='utf16le'
        offset=[int64]$offset
        context=(Protect-Text $text.Trim())
      }
    }
  }
  return $result
}

$seed = [ordered]@{
  schema='wwmsync-native-diagnostic-v5'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  requestedGameExe=Protect-Text $GameExe
  installRoot=Protect-Text (Get-InstallRoot $GameExe)
  safety=[ordered]@{
    memoryRead=$false
    injection=$false
    packetCapture=$false
    activeNetworkProbe=$false
    pipeConnect=$false
    pipeWrite=$false
    credentialCollection=$false
    registryWrite=$false
    gameFileWrite=$false
    staticFileRead=$true
  }
  needles=$Needles
  files=@()
  summary=$null
}
Write-Json $seed
Write-Host 'WWMSync static launcher/pipe diagnostic v5 (READ-ONLY)' -ForegroundColor Cyan
Write-Host "JSON created immediately: $OutputPath"

$candidates=@(Get-CandidateFiles $GameExe)
$scanned=@()
foreach($path in $candidates){
  Write-Host "Scanning: $path"
  $r=Scan-File $path
  $scanned += $r
  $seed.files=$scanned
  Write-Json $seed
}

$hitFiles=@($scanned | Where-Object { @($_.hits).Count -gt 0 })
$hitCount=0; foreach($f in $scanned){$hitCount += @($f.hits).Count}
$seed.status='complete'
$seed.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
$seed.files=$scanned
$seed.summary=[ordered]@{
  candidateFiles=$candidates.Count
  scannedFiles=@($scanned | Where-Object {-not $_.skipped}).Count
  skippedFiles=@($scanned | Where-Object {$_.skipped}).Count
  filesWithHits=$hitFiles.Count
  totalHits=$hitCount
  launcherPipeHits=@($scanned | ForEach-Object {$_.hits} | Where-Object {$_.needle -eq 'wwm_launcher_server'}).Count
}
Write-Json $seed
Write-Host "Complete. files=$($seed.summary.scannedFiles) hits=$($seed.summary.totalHits) launcherPipeHits=$($seed.summary.launcherPipeHits)" -ForegroundColor Green
Write-Host "Output: $OutputPath"
