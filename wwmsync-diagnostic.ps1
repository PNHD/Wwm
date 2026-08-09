[CmdletBinding()]
param(
  [ValidateRange(5,120)][int]$Seconds = 20,
  [string]$GameExe = '',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v4.json')
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native bridge diagnostic v4.
# READ ONLY: no process-memory reads, injection, packet capture, active network probes,
# credential collection, registry writes, or game-file modification.

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
  $Object | ConvertTo-Json -Depth 14 | Set-Content -Path $OutputPath -Encoding UTF8
}

function Get-InstallRoot([string]$ExePath) {
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

function Select-GameChain($All,[string]$ExePath) {
  $root = Get-InstallRoot $ExePath
  $exeName = if ($ExePath) { [IO.Path]::GetFileName($ExePath) } else { 'wwm.exe' }
  $selected = @{}

  foreach ($p in $All) {
    if ([int]$p.pid -eq $PID) { continue }
    $path = [string]$p.executablePath
    $name = [string]$p.name
    $match = $false
    if ($ExePath -and $path -and ($path -ieq $ExePath)) { $match = $true }
    elseif ($name -ieq $exeName) { $match = $true }
    elseif ($name -match '(?i)(wwm|wherewinds|yysls|unicrashreporter|unisdk|netease|everstone|orbit|roost|mpay|launcher)') { $match = $true }
    elseif ($root -and $path -and $path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) { $match = $true }
    if ($match) { $selected[$p.pid] = $p }
  }

  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($p in $All) {
      if ([int]$p.pid -eq $PID) { continue }
      if (-not $selected.ContainsKey($p.pid) -and $selected.ContainsKey($p.parentPid)) {
        $selected[$p.pid] = $p; $changed = $true
      }
    }
  }

  $byPid = @{}; foreach ($p in $All) { $byPid[$p.pid] = $p }
  $frontier = @($selected.Values)
  for ($depth=0; $depth -lt 5; $depth++) {
    $next = @()
    foreach ($p in $frontier) {
      $ppid = [int]$p.parentPid
      if ($ppid -gt 0 -and $byPid.ContainsKey($ppid) -and -not $selected.ContainsKey($ppid)) {
        $parent = $byPid[$ppid]
        if ([string]$parent.name -notmatch '(?i)^(powershell|pwsh|windowsterminal)\.exe$') {
          $selected[$ppid] = $parent
          $next += $parent
        }
      }
    }
    if ($next.Count -eq 0) { break }
    $frontier = $next
  }

  $out = @()
  foreach ($p in @($selected.Values | Sort-Object pid)) {
    $out += [ordered]@{
      pid=[int]$p.pid
      parentPid=[int]$p.parentPid
      name=Protect-Text $p.name
      executablePath=Protect-Text $p.executablePath
      commandLine=Protect-Text $p.commandLine
    }
  }
  return $out
}

function Get-CandidateHelpers($All,[string]$ExePath) {
  $root = Get-InstallRoot $ExePath
  $out = @()
  foreach ($p in $All) {
    if ([int]$p.pid -eq $PID) { continue }
    $hay = "$($p.name) $($p.executablePath)"
    $match = $hay -match '(?i)(wwm|wherewinds|yysls|netease|unisdk|everstone|orbit|roost|mpay|webview|cef|launcher)'
    if (-not $match -and $root -and $p.executablePath) { $match = ([string]$p.executablePath).StartsWith($root,[StringComparison]::OrdinalIgnoreCase) }
    if ($match) {
      $out += [ordered]@{
        pid=[int]$p.pid
        parentPid=[int]$p.parentPid
        name=Protect-Text $p.name
        executablePath=Protect-Text $p.executablePath
      }
    }
  }
  return @($out | Sort-Object pid -Unique)
}

function Get-NetstatRows($PidNameMap,$SelectedPids) {
  $selected = @(); $localBridge = @()
  foreach ($line in @(& netstat.exe -ano 2>$null)) {
    $trim = ([string]$line).Trim()
    if (-not ($trim.StartsWith('TCP ') -or $trim.StartsWith('UDP '))) { continue }
    $parts = @($trim -split '\s+')
    if ($parts.Count -lt 4) { continue }
    $proto = $parts[0].ToLowerInvariant()
    $pidIndex = $parts.Count - 1
    $owner = 0
    if (-not [int]::TryParse($parts[$pidIndex],[ref]$owner)) { continue }
    $local = $parts[1]
    $remote = $parts[2]
    $state = if ($proto -eq 'tcp' -and $parts.Count -ge 5) { $parts[3] } else { $null }
    $pname = if ($PidNameMap.ContainsKey($owner)) { $PidNameMap[$owner] } else { '' }
    $row = [ordered]@{
      protocol=$proto
      pid=$owner
      process=Protect-Text $pname
      state=$state
      localEndpoint=Protect-Text $local
      remoteEndpoint=Protect-Text $remote
    }
    if ($SelectedPids.ContainsKey($owner)) { $selected += $row }
    $loopback = $local -match '^(127\.0\.0\.1|\[::1\]|::1):'
    $listener = ($state -eq 'LISTENING')
    $helperName = $pname -match '(?i)(wwm|wherewinds|yysls|netease|unisdk|everstone|orbit|roost|mpay|webview|cef|launcher)'
    if ($loopback -or ($listener -and $helperName)) { $localBridge += $row }
  }
  return [ordered]@{
    selectedProcessSockets=@($selected | Sort-Object protocol,pid,localEndpoint,remoteEndpoint -Unique)
    loopbackOrRelevantListeners=@($localBridge | Sort-Object protocol,pid,localEndpoint,remoteEndpoint -Unique | Select-Object -First 120)
  }
}

function Get-InterestingPipes {
  $out = @()
  try {
    foreach ($item in Get-ChildItem -Path '\\.\pipe\') {
      $name = [string]$item.Name
      if ($name -match '(?i)(wwm|wherewinds|yysls|netease|unisdk|everstone|orbit|roost|mpay|webview|cef|h72)') {
        $out += (Protect-Text $name)
      }
    }
  } catch {}
  return @($out | Sort-Object -Unique | Select-Object -First 120)
}

function Get-UriProtocols([string]$ExePath) {
  $rootHint = Get-InstallRoot $ExePath
  $out = @()
  $roots = @(
    [pscustomobject]@{scope='user'; path='Registry::HKEY_CURRENT_USER\Software\Classes'},
    [pscustomobject]@{scope='machine'; path='Registry::HKEY_LOCAL_MACHINE\Software\Classes'}
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root.path)) { continue }
    foreach ($key in @(Get-ChildItem -LiteralPath $root.path)) {
      $item = Get-Item -LiteralPath $key.PSPath
      if ($null -eq $item) { continue }
      $urlMarker = $item.GetValue('URL Protocol',$null)
      if ($null -eq $urlMarker) { continue }
      $name = [string]$key.PSChildName
      $defaultValue = [string]$item.GetValue('',$null)
      $command = $null
      $cmdKey = Get-Item -LiteralPath ($key.PSPath + '\shell\open\command')
      if ($cmdKey) { $command = [string]$cmdKey.GetValue('',$null) }
      $hay = "$name $defaultValue $command"
      $interesting = $hay -match '(?i)(wwm|wherewinds|where winds|yysls|netease|unisdk|everstone|orbit|roost|mpay|h72|launcher)'
      if (-not $interesting -and $rootHint) { $interesting = $hay.IndexOf($rootHint,[StringComparison]::OrdinalIgnoreCase) -ge 0 }
      if ($interesting) {
        $out += [ordered]@{
          scope=$root.scope
          protocol=Protect-Text $name
          description=Protect-Text $defaultValue
          command=Protect-Text $command
        }
      }
    }
  }
  return @($out | Sort-Object scope,protocol -Unique)
}

function Get-StaticMetadata([string]$ExePath) {
  $out=@()
  if (-not $ExePath) { return $out }
  $dir=Split-Path -Parent $ExePath
  foreach ($name in @('protocol.data','netease_global.data','netease.data','ReadMe_UniSDK.txt','webview_support_cef_enabled','NtUniSdkProtocol.dll','NtUniSdkNgWebview.dll','webview_support_helper.dll','UniWER.dll')) {
    $path=Join-Path $dir $name
    if (-not (Test-Path $path -PathType Leaf)) { continue }
    $item=Get-Item $path
    $sha=$null; try { $sha=(Get-FileHash -Algorithm SHA256 -Path $path).Hash } catch {}
    $out += [ordered]@{name=$name;length=[int64]$item.Length;sha256=$sha}
  }
  return $out
}

function Get-BridgeSnapshot([string]$ExePath) {
  $all=@(Get-ProcessUniverse)
  $chain=@(Select-GameChain $all $ExePath)
  $helpers=@(Get-CandidateHelpers $all $ExePath)
  $pidNames=@{}; foreach($p in $all){$pidNames[[int]$p.pid]=[string]$p.name}
  $selectedPids=@{}; foreach($p in $chain){$selectedPids[[int]$p.pid]=$true}
  [ordered]@{
    atUtc=[DateTime]::UtcNow.ToString('o')
    gameChain=$chain
    candidateHelpers=$helpers
    network=(Get-NetstatRows $pidNames $selectedPids)
    namedPipes=@(Get-InterestingPipes)
  }
}

$seed=[ordered]@{
  schema='wwmsync-native-diagnostic-v4'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  observationSeconds=$Seconds
  requestedGameExe=Protect-Text $GameExe
  installRoot=Protect-Text (Get-InstallRoot $GameExe)
  safety=[ordered]@{memoryRead=$false;injection=$false;packetCapture=$false;activeNetworkProbe=$false;credentialCollection=$false;registryRead=$true;registryWrite=$false;gameFileWrite=$false}
  staticMetadata=@(Get-StaticMetadata $GameExe)
  uriProtocols=@(Get-UriProtocols $GameExe)
  before=$null
  after=$null
}
Write-Json $seed
Write-Host 'WWMSync native bridge diagnostic v4 (READ-ONLY)' -ForegroundColor Cyan
Write-Host "JSON created immediately: $OutputPath"

$seed.before=Get-BridgeSnapshot $GameExe
Write-Json $seed

for($left=$Seconds;$left -gt 0;$left--){
  Write-Progress -Activity 'Observing WWM URI/IPC/local bridge surfaces' -Status "$left seconds remaining" -PercentComplete ([int](100*($Seconds-$left)/$Seconds))
  Start-Sleep -Seconds 1
}
Write-Progress -Activity 'Observing WWM URI/IPC/local bridge surfaces' -Completed

$seed.after=Get-BridgeSnapshot $GameExe
$seed.status='complete'
$seed.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
Write-Json $seed
Write-Host "Complete. URI protocols=$(@($seed.uriProtocols).Count) pipes=$(@($seed.after.namedPipes).Count) gameSockets=$(@($seed.after.network.selectedProcessSockets).Count)" -ForegroundColor Green
Write-Host "Output: $OutputPath"
