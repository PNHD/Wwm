[CmdletBinding()]
param(
  [string]$GameExe = '',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v6.json')
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# WWMSync diagnostic v6: resolve the real launcher file and locate the literal
# wwm_launcher_server pipe string on disk. READ ONLY: no memory reads, injection,
# packet capture, active probes, pipe connections/writes, registry writes, or game-file writes.

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return $null }
  $s = [string]$Text
  if ($env:USERPROFILE) { $s = $s.Replace($env:USERPROFILE, '<USERPROFILE>') }
  if ($env:USERNAME) { $s = $s -replace [regex]::Escape($env:USERNAME), '<USER>' }
  $s = $s -replace '(?i)(token|ticket|session|password|passwd|secret|authorization)=\S+', '$1=<REDACTED>'
  $s = $s -replace '[A-Fa-f0-9]{40,}', '<LONG_HEX>'
  $s = $s -replace '[A-Za-z0-9_-]{64,}', '<LONG_TOKEN>'
  return $s
}

function Write-Json($Object) {
  $parent = Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 14 | Set-Content -Path $OutputPath -Encoding UTF8
}

function Get-InstallRoot([string]$ExePath) {
  if (-not $ExePath) { return '' }
  $p = Split-Path -Parent $ExePath
  for ($i=0; $i -lt 3; $i++) { if ($p) { $p = Split-Path -Parent $p } }
  return $p
}

function Get-SearchRoot([string]$ExePath) {
  $install = Get-InstallRoot $ExePath
  if (-not $install) { return '' }
  $parent = Split-Path -Parent $install
  if ($parent) { return $parent }
  return $install
}

function Resolve-ProcessPath([int]$Pid) {
  $out = [ordered]@{ pid=$Pid; name=$null; cimPath=$null; getProcessPath=$null; mainModulePath=$null }
  if ($Pid -le 0) { return $out }
  try {
    $c = Get-CimInstance Win32_Process -Filter "ProcessId=$Pid"
    if ($c) { $out.name=Protect-Text $c.Name; $out.cimPath=Protect-Text $c.ExecutablePath }
  } catch {}
  try {
    $p = Get-Process -Id $Pid -ErrorAction Stop
    if (-not $out.name) { $out.name=Protect-Text $p.ProcessName }
    $out.getProcessPath=Protect-Text $p.Path
    try { $out.mainModulePath=Protect-Text $p.MainModule.FileName } catch {}
  } catch {}
  return $out
}

function Get-GameAndLauncherProcess {
  $game = $null
  try {
    $all = @(Get-CimInstance Win32_Process)
    $exeName = if ($GameExe) { [IO.Path]::GetFileName($GameExe) } else { 'wwm.exe' }
    $game = @($all | Where-Object { $_.Name -ieq $exeName } | Select-Object -First 1)[0]
    if (-not $game) { return [ordered]@{ game=$null; parent=$null } }
    $parent = @($all | Where-Object { [int]$_.ProcessId -eq [int]$game.ParentProcessId } | Select-Object -First 1)[0]
    return [ordered]@{
      game = Resolve-ProcessPath ([int]$game.ProcessId)
      parent = if ($parent) { Resolve-ProcessPath ([int]$parent.ProcessId) } else { $null }
    }
  } catch { return [ordered]@{ game=$null; parent=$null } }
}

function Find-Literal([string]$Path,[string]$Needle) {
  $result=@()
  try {
    $item=Get-Item -LiteralPath $Path
    if ($item.Length -gt 268435456) { return $result }
    $bytes=[IO.File]::ReadAllBytes($Path)
    $ascii=[Text.Encoding]::ASCII.GetString($bytes)
    $idx=$ascii.IndexOf($Needle,[StringComparison]::Ordinal)
    if ($idx -ge 0) {
      $start=[Math]::Max(0,$idx-320); $len=[Math]::Min(900,$ascii.Length-$start)
      $ctx=($ascii.Substring($start,$len) -replace '[^\x20-\x7E]',' ' -replace '\s+',' ').Trim()
      $result += [ordered]@{encoding='ascii';offset=[int64]$idx;context=Protect-Text $ctx}
    }
    $wide=[Text.Encoding]::Unicode.GetString($bytes)
    $widx=$wide.IndexOf($Needle,[StringComparison]::Ordinal)
    if ($widx -ge 0) {
      $start=[Math]::Max(0,$widx-240); $len=[Math]::Min(700,$wide.Length-$start)
      $ctx=($wide.Substring($start,$len) -replace '[^\x20-\x7E]',' ' -replace '\s+',' ').Trim()
      $result += [ordered]@{encoding='utf16le';offset=[int64]($widx*2);context=Protect-Text $ctx}
    }
  } catch {}
  return $result
}

function File-Meta([string]$Path) {
  try {
    $i=Get-Item -LiteralPath $Path
    $sha=$null; try { $sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash } catch {}
    return [ordered]@{ path=Protect-Text $i.FullName; name=$i.Name; length=[int64]$i.Length; sha256=$sha }
  } catch { return $null }
}

$seed=[ordered]@{
  schema='wwmsync-native-diagnostic-v6'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  requestedGameExe=Protect-Text $GameExe
  installRoot=Protect-Text (Get-InstallRoot $GameExe)
  searchRoot=Protect-Text (Get-SearchRoot $GameExe)
  safety=[ordered]@{memoryRead=$false;injection=$false;packetCapture=$false;activeNetworkProbe=$false;pipeConnect=$false;pipeWrite=$false;registryWrite=$false;gameFileWrite=$false;staticFileRead=$true;processMetadataRead=$true}
  processResolution=$null
  launcherCandidates=@()
  pipeHits=@()
  scanSummary=$null
}
Write-Json $seed

$seed.processResolution=Get-GameAndLauncherProcess
Write-Json $seed

$searchRoot=Get-SearchRoot $GameExe
$candidates=New-Object System.Collections.ArrayList
if ($searchRoot -and (Test-Path -LiteralPath $searchRoot)) {
  foreach($f in @(Get-ChildItem -LiteralPath $searchRoot -File -Recurse -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '(?i)(launcher|cortex|wwm|wherewinds)' -and $_.Extension -match '(?i)^\.(exe|dll|bin|data)$'
  } | Select-Object -First 250)) { [void]$candidates.Add($f.FullName) }
}

# Prefer any resolved live launcher path, even if it is outside E:\wwm.
foreach($p in @($seed.processResolution.game,$seed.processResolution.parent)) {
  if ($p) {
    foreach($k in @('cimPath','getProcessPath','mainModulePath')) {
      $raw=[string]$p[$k]
      if ($raw -and $raw -notmatch '^<') {
        $exists=$false; foreach($x in $candidates){if([string]$x -ieq $raw){$exists=$true;break}}
        if (-not $exists -and (Test-Path -LiteralPath $raw -PathType Leaf)) { [void]$candidates.Add($raw) }
      }
    }
  }
}

$metas=@(); $hits=@(); $scanned=0
foreach($path in @($candidates)) {
  $m=File-Meta $path; if ($m) { $metas += $m }
  $h=@(Find-Literal $path 'wwm_launcher_server')
  $scanned++
  foreach($one in $h) {
    $hits += [ordered]@{ path=Protect-Text $path; name=[IO.Path]::GetFileName($path); encoding=$one.encoding; offset=$one.offset; context=$one.context }
  }
}

$seed.launcherCandidates=$metas
$seed.pipeHits=$hits
$seed.scanSummary=[ordered]@{candidateFiles=$candidates.Count;scannedFiles=$scanned;pipeHitFiles=@($hits | Select-Object -ExpandProperty path -Unique).Count;totalPipeHits=$hits.Count}
$seed.status='complete'; $seed.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
Write-Json $seed
Write-Host "Complete. candidates=$($seed.scanSummary.candidateFiles) pipeHits=$($seed.scanSummary.totalPipeHits)" -ForegroundColor Green
Write-Host "Output: $OutputPath"
