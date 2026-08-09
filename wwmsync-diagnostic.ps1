[CmdletBinding()]
param(
  [ValidateRange(5, 180)]
  [int]$Seconds = 30,
  [string]$GameExe = '',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic.json')
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# WWMSync targeted native diagnostic v2.
# Read-only: no process-memory reads, injection, packet capture, active network probes,
# credential collection, registry writes, or game-file modification.

function Protect-Text {
  param([string]$Text)
  if ($null -eq $Text) { return $null }
  $s = [string]$Text
  if ($env:USERPROFILE) { $s = $s.Replace($env:USERPROFILE, '<USERPROFILE>') }
  if ($env:USERNAME) { $s = $s -replace [regex]::Escape($env:USERNAME), '<USER>' }
  $s = $s -replace '(?i)(token|ticket|session|password|passwd|secret|authorization)=\S+', '$1=<REDACTED>'
  $s = $s -replace '[A-Fa-f0-9]{40,}', '<LONG_HEX>'
  $s = $s -replace '[A-Za-z0-9_-]{64,}', '<LONG_TOKEN>'
  return $s
}

function Write-Json {
  param($Object)
  $parent = Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 10 | Set-Content -Path $OutputPath -Encoding UTF8
}

function Get-RootHint {
  param([string]$ExePath)
  if ([string]::IsNullOrWhiteSpace($ExePath)) { return '' }
  $p = Split-Path -Parent $ExePath
  for ($i = 0; $i -lt 3; $i++) {
    if ($p) { $p = Split-Path -Parent $p }
  }
  return $p
}

function Get-ProcessSnapshot {
  param([string]$ExePath)
  $all = @(Get-CimInstance Win32_Process)
  $exeName = if ($ExePath) { [IO.Path]::GetFileName($ExePath) } else { 'wwm.exe' }
  $rootHint = Get-RootHint $ExePath
  $selected = @()

  foreach ($p in $all) {
    $path = [string]$p.ExecutablePath
    $name = [string]$p.Name
    $cmd = [string]$p.CommandLine
    $match = $false

    if ($ExePath -and $path -and ($path -ieq $ExePath)) { $match = $true }
    elseif ($name -ieq $exeName) { $match = $true }
    elseif ($rootHint -and $path -and $path.StartsWith($rootHint, [StringComparison]::OrdinalIgnoreCase)) { $match = $true }
    elseif ($rootHint -and $cmd -and $cmd.IndexOf($rootHint, [StringComparison]::OrdinalIgnoreCase) -ge 0) { $match = $true }

    if ($match) {
      $selected += [ordered]@{
        pid = [int]$p.ProcessId
        parentPid = [int]$p.ParentProcessId
        name = Protect-Text $name
        executablePath = Protect-Text $path
        commandLine = Protect-Text $cmd
      }
    }
  }

  # Include direct children of selected processes, even when they run outside the game directory.
  $known = @{}
  foreach ($x in $selected) { $known[[int]$x.pid] = $true }
  $added = $true
  while ($added) {
    $added = $false
    foreach ($p in $all) {
      $pidValue = [int]$p.ProcessId
      $ppid = [int]$p.ParentProcessId
      if ($known.ContainsKey($pidValue)) { continue }
      if ($known.ContainsKey($ppid)) {
        $known[$pidValue] = $true
        $selected += [ordered]@{
          pid = $pidValue
          parentPid = $ppid
          name = Protect-Text ([string]$p.Name)
          executablePath = Protect-Text ([string]$p.ExecutablePath)
          commandLine = Protect-Text ([string]$p.CommandLine)
        }
        $added = $true
      }
    }
  }

  return @($selected | Sort-Object pid -Unique)
}

function Get-NetworkSnapshot {
  param($Processes)
  $pids = @{}
  foreach ($p in @($Processes)) { $pids[[string]$p.pid] = [string]$p.name }
  $rows = @()
  foreach ($line in @(netstat -ano 2>$null)) {
    $parts = @($line.Trim() -split '\s+' | Where-Object { $_ -ne '' })
    if ($parts.Count -lt 4) { continue }
    $proto = $parts[0].ToUpperInvariant()
    if ($proto -eq 'TCP' -and $parts.Count -ge 5) {
      $pid = $parts[4]
      if ($pids.ContainsKey($pid)) {
        $rows += [ordered]@{ protocol='tcp'; local=$parts[1]; remote=$parts[2]; state=$parts[3]; pid=[int]$pid; process=$pids[$pid] }
      }
    } elseif ($proto -eq 'UDP' -and $parts.Count -ge 4) {
      $pid = $parts[3]
      if ($pids.ContainsKey($pid)) {
        $rows += [ordered]@{ protocol='udp'; local=$parts[1]; remote=$parts[2]; state=$null; pid=[int]$pid; process=$pids[$pid] }
      }
    }
  }
  return @($rows | Sort-Object protocol, pid, local, remote -Unique)
}

function Get-PrintableStrings {
  param([string]$Path)
  try {
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -gt 131072) { return @() }
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    $hits = @([regex]::Matches($text, '[ -~]{4,}') | ForEach-Object { Protect-Text $_.Value.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
    return @($hits | Select-Object -First 120)
  } catch { return @() }
}

function Get-StaticBridgeFiles {
  param([string]$ExePath)
  if ([string]::IsNullOrWhiteSpace($ExePath)) { return @() }
  $dir = Split-Path -Parent $ExePath
  if (-not (Test-Path $dir)) { return @() }
  $out = @()
  foreach ($f in @(Get-ChildItem -LiteralPath $dir -File)) {
    if ($f.Name -notmatch '(?i)(protocol|uni|sdk|webview|bridge|ipc|mpay|netease|cef|helper)') { continue }
    $entry = [ordered]@{
      name = [string]$f.Name
      length = [int64]$f.Length
      lastWriteUtc = $f.LastWriteTimeUtc.ToString('o')
      printableStrings = @()
    }
    if ($f.Length -le 131072 -and ($f.Extension -in @('.txt','.data','.ini','.cfg','.json','.xml','') -or $f.Name -match '(?i)protocol|readme|webview_support')) {
      $entry.printableStrings = @(Get-PrintableStrings $f.FullName)
    }
    $out += $entry
  }
  return @($out | Sort-Object name)
}

function Get-Delta {
  param($Before, $After)
  $b = @{}
  foreach ($x in @($Before.network)) { $b["$($x.protocol)|$($x.local)|$($x.remote)|$($x.state)|$($x.pid)"] = $x }
  $a = @{}
  foreach ($x in @($After.network)) { $a["$($x.protocol)|$($x.local)|$($x.remote)|$($x.state)|$($x.pid)"] = $x }
  $bp = @{}
  foreach ($x in @($Before.processes)) { $bp[[string]$x.pid] = $x }
  $ap = @{}
  foreach ($x in @($After.processes)) { $ap[[string]$x.pid] = $x }
  return [ordered]@{
    addedNetwork = @($a.Keys | Where-Object { -not $b.ContainsKey($_) } | ForEach-Object { $a[$_] })
    removedNetwork = @($b.Keys | Where-Object { -not $a.ContainsKey($_) } | ForEach-Object { $b[$_] })
    addedProcesses = @($ap.Keys | Where-Object { -not $bp.ContainsKey($_) } | ForEach-Object { $ap[$_] })
    removedProcesses = @($bp.Keys | Where-Object { -not $ap.ContainsKey($_) } | ForEach-Object { $bp[$_] })
  }
}

if ($GameExe) {
  try { $GameExe = [IO.Path]::GetFullPath($GameExe) } catch {}
}

$result = [ordered]@{
  schema = 'wwmsync-native-diagnostic-v2'
  status = 'starting'
  generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  observationSeconds = $Seconds
  requestedGameExe = Protect-Text $GameExe
  safety = [ordered]@{
    memoryRead = $false
    injection = $false
    packetCapture = $false
    activeNetworkProbe = $false
    credentialCollection = $false
    registryWrite = $false
    gameFileWrite = $false
  }
  staticBridgeFiles = @()
  before = $null
  after = $null
  delta = $null
}

# Write immediately so the user always gets a JSON even if a later Windows query stalls.
Write-Json $result

Write-Host ''
Write-Host 'WWMSync targeted diagnostic v2 (READ-ONLY)' -ForegroundColor Cyan
Write-Host "Output created immediately: $OutputPath"
Write-Host "Game executable: $GameExe"
Write-Host ''

$result.staticBridgeFiles = @(Get-StaticBridgeFiles $GameExe)
$beforeProcesses = @(Get-ProcessSnapshot $GameExe)
$before = [ordered]@{
  atUtc = [DateTime]::UtcNow.ToString('o')
  processes = $beforeProcesses
  network = @(Get-NetworkSnapshot $beforeProcesses)
}
$result.before = $before
$result.status = 'observing'
Write-Json $result

Write-Host "Matched game/related processes: $(@($beforeProcesses).Count)"
Write-Host "Observed game-owned sockets: $(@($before.network).Count)"
Write-Host "Static bridge candidates: $(@($result.staticBridgeFiles).Count)"
Write-Host "For the next $Seconds seconds: move the character, open the in-game map, then close it."

for ($left = $Seconds; $left -gt 0; $left--) {
  Write-Progress -Activity 'Observing WWM process and socket metadata' -Status "$left seconds remaining" -PercentComplete ([int](100 * ($Seconds - $left) / $Seconds))
  Start-Sleep -Seconds 1
}
Write-Progress -Activity 'Observing WWM process and socket metadata' -Completed

$afterProcesses = @(Get-ProcessSnapshot $GameExe)
$after = [ordered]@{
  atUtc = [DateTime]::UtcNow.ToString('o')
  processes = $afterProcesses
  network = @(Get-NetworkSnapshot $afterProcesses)
}
$result.after = $after
$result.delta = Get-Delta $before $after
$result.status = 'complete'
$result.generatedAtUtc = [DateTime]::UtcNow.ToString('o')
Write-Json $result

Write-Host ''
Write-Host 'Diagnostic complete.' -ForegroundColor Green
Write-Host "JSON: $OutputPath"
Write-Host "JSON EXISTS: $(Test-Path $OutputPath)"
Write-Host "Added sockets: $(@($result.delta.addedNetwork).Count)"
Write-Host "Removed sockets: $(@($result.delta.removedNetwork).Count)"
Write-Host ''
Write-Host 'Upload only wwmsync-diagnostic.json to ChatGPT.'
