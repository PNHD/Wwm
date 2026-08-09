[CmdletBinding()]
param(
  [ValidateRange(5,180)][int]$Seconds = 30,
  [string]$GameExe = '',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic.json')
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# WWMSync targeted native diagnostic v3.
# READ ONLY: no process-memory reads, injection, packet capture, active network probes,
# credential collection, registry writes, or game-file modification.

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
  $Object | ConvertTo-Json -Depth 12 | Set-Content -Path $OutputPath -Encoding UTF8
}

function Get-RootHint([string]$ExePath) {
  if ([string]::IsNullOrWhiteSpace($ExePath)) { return '' }
  $p = Split-Path -Parent $ExePath
  for ($i=0; $i -lt 3; $i++) { if ($p) { $p = Split-Path -Parent $p } }
  return $p
}

function Get-ProcessUniverse {
  $rows = @()
  foreach ($p in @(Get-CimInstance Win32_Process)) {
    $rows += [pscustomobject]@{
      pid = [int]$p.ProcessId
      parentPid = [int]$p.ParentProcessId
      name = [string]$p.Name
      executablePath = [string]$p.ExecutablePath
      commandLine = [string]$p.CommandLine
    }
  }
  return $rows
}

function Select-ProcessChain($All,[string]$ExePath) {
  $rootHint = Get-RootHint $ExePath
  $exeName = if ($ExePath) { [IO.Path]::GetFileName($ExePath) } else { 'wwm.exe' }
  $selected = @{}

  foreach ($p in $All) {
    $path = [string]$p.executablePath
    $name = [string]$p.name
    $cmd = [string]$p.commandLine
    $match = $false
    if ($ExePath -and $path -and ($path -ieq $ExePath)) { $match = $true }
    elseif ($name -ieq $exeName) { $match = $true }
    elseif ($name -match '(?i)(wwm|wherewinds|yysls|unicrashreporter|unisdk|netease)') { $match = $true }
    elseif ($rootHint -and $path -and $path.StartsWith($rootHint,[StringComparison]::OrdinalIgnoreCase)) { $match = $true }
    elseif ($rootHint -and $cmd -and $cmd.IndexOf($rootHint,[StringComparison]::OrdinalIgnoreCase) -ge 0) { $match = $true }
    if ($match) { $selected[$p.pid] = $p }
  }

  # Descendants of anything already selected.
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $All) {
      if (-not $selected.ContainsKey($p.pid) -and $selected.ContainsKey($p.parentPid)) {
        $selected[$p.pid] = $p; $changed = $true
      }
    }
  }

  # Ancestors are critical for protected game processes whose executable path is hidden.
  $byPid = @{}; foreach ($p in $All) { $byPid[$p.pid] = $p }
  $frontier = @($selected.Values)
  for ($depth=0; $depth -lt 6; $depth++) {
    $next = @()
    foreach ($p in $frontier) {
      $ppid = [int]$p.parentPid
      if ($ppid -gt 0 -and $byPid.ContainsKey($ppid) -and -not $selected.ContainsKey($ppid)) {
        $selected[$ppid] = $byPid[$ppid]
        $next += $byPid[$ppid]
      }
    }
    if ($next.Count -eq 0) { break }
    $frontier = $next
  }

  $out = @()
  foreach ($p in @($selected.Values | Sort-Object pid)) {
    $out += [ordered]@{
      pid = [int]$p.pid
      parentPid = [int]$p.parentPid
      name = Protect-Text $p.name
      executablePath = Protect-Text $p.executablePath
      commandLine = Protect-Text $p.commandLine
    }
  }
  return $out
}

function Get-ProcessNetwork($Processes) {
  $pids = @{}; foreach ($p in @($Processes)) { $pids[[int]$p.pid] = [string]$p.name }
  $rows = @()
  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    foreach ($c in @(Get-NetTCPConnection)) {
      $pid = [int]$c.OwningProcess
      if ($pids.ContainsKey($pid)) {
        $rows += [ordered]@{ protocol='tcp'; pid=$pid; process=$pids[$pid]; state=[string]$c.State; localAddress=[string]$c.LocalAddress; localPort=[int]$c.LocalPort; remoteAddress=[string]$c.RemoteAddress; remotePort=[int]$c.RemotePort }
      }
    }
  }
  if (Get-Command Get-NetUDPEndpoint -ErrorAction SilentlyContinue) {
    foreach ($c in @(Get-NetUDPEndpoint)) {
      $pid = [int]$c.OwningProcess
      if ($pids.ContainsKey($pid)) {
        $rows += [ordered]@{ protocol='udp'; pid=$pid; process=$pids[$pid]; state=$null; localAddress=[string]$c.LocalAddress; localPort=[int]$c.LocalPort; remoteAddress=$null; remotePort=$null }
      }
    }
  }
  return @($rows | Sort-Object protocol,pid,localPort,remotePort -Unique)
}

function Get-Snapshot([string]$ExePath) {
  $all = @(Get-ProcessUniverse)
  $processes = @(Select-ProcessChain $all $ExePath)
  return [ordered]@{
    atUtc = [DateTime]::UtcNow.ToString('o')
    processes = $processes
    network = @(Get-ProcessNetwork $processes)
  }
}

function Get-StaticHints([string]$ExePath) {
  $out = @()
  if (-not $ExePath) { return $out }
  $dir = Split-Path -Parent $ExePath
  foreach ($name in @('protocol.data','netease_global.data','netease.data','ReadMe_UniSDK.txt','webview_support_cef_enabled')) {
    $path = Join-Path $dir $name
    if (-not (Test-Path $path -PathType Leaf)) { continue }
    $item = Get-Item $path
    $sha = $null; try { $sha = (Get-FileHash -Algorithm SHA256 -Path $path).Hash } catch {}
    $preview = @()
    if ($item.Length -le 65536) {
      try {
        $bytes = [IO.File]::ReadAllBytes($path)
        $text = [Text.Encoding]::ASCII.GetString($bytes)
        $preview = @([regex]::Matches($text,'[ -~]{4,}') | ForEach-Object { Protect-Text $_.Value } | Select-Object -First 80)
      } catch {}
    }
    $out += [ordered]@{ name=$name; length=[int64]$item.Length; sha256=$sha; printableStrings=$preview }
  }
  return $out
}

function Key-Set($Items) {
  $h=@{}; foreach($x in @($Items)) { $k="$($x.protocol)|$($x.pid)|$($x.localAddress)|$($x.localPort)|$($x.remoteAddress)|$($x.remotePort)|$($x.state)"; $h[$k]=$x }; return $h
}

$seed = [ordered]@{
  schema='wwmsync-native-diagnostic-v3'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  observationSeconds=$Seconds
  requestedGameExe=(Protect-Text $GameExe)
  safety=[ordered]@{ memoryRead=$false; injection=$false; packetCapture=$false; activeNetworkProbe=$false; credentialCollection=$false; registryWrite=$false; gameFileWrite=$false }
  staticBridgeFiles=@(Get-StaticHints $GameExe)
  before=$null; after=$null; delta=$null
}
Write-Json $seed
Write-Host 'WWMSync native diagnostic v3 (READ-ONLY)' -ForegroundColor Cyan
Write-Host "JSON created immediately: $OutputPath"

$before = Get-Snapshot $GameExe
$seed.before = $before
Write-Json $seed

for ($left=$Seconds; $left -gt 0; $left--) {
  Write-Progress -Activity 'Observing WWM process ancestry and socket metadata' -Status "$left seconds remaining" -PercentComplete ([int](100*($Seconds-$left)/$Seconds))
  Start-Sleep -Seconds 1
}
Write-Progress -Activity 'Observing WWM process ancestry and socket metadata' -Completed

$after = Get-Snapshot $GameExe
$b = Key-Set $before.network; $a = Key-Set $after.network
$delta = [ordered]@{
  addedNetwork=@($a.Keys | Where-Object { -not $b.ContainsKey($_) } | ForEach-Object { $a[$_] })
  removedNetwork=@($b.Keys | Where-Object { -not $a.ContainsKey($_) } | ForEach-Object { $b[$_] })
}
$seed.status='complete'; $seed.generatedAtUtc=[DateTime]::UtcNow.ToString('o'); $seed.after=$after; $seed.delta=$delta
Write-Json $seed
Write-Host "Complete. Processes=$(@($after.processes).Count) sockets=$(@($after.network).Count)" -ForegroundColor Green
Write-Host "Output: $OutputPath"
