[CmdletBinding()]
param(
  [ValidateRange(10, 300)]
  [int]$Seconds = 45,
  [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'wwmsync-diagnostic.json')
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native-bridge diagnostic.
# Read-only by design: no process memory access, injection, packet capture,
# credential/token collection, registry writes, or network probing.

$keywords = @(
  'wherewinds', 'where winds', 'wwm', 'yysls', 'yanyun',
  'netease', 'everstone', 'unisdk', 'h72', 'yan yun', '燕云', '燕雲'
)

function Test-InterestingText {
  param([string]$Text)
  if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
  $lower = $Text.ToLowerInvariant()
  foreach ($k in $keywords) {
    if ($lower.Contains($k.ToLowerInvariant())) { return $true }
  }
  return $false
}

function Protect-Text {
  param([string]$Text)
  if ($null -eq $Text) { return $null }
  $s = [string]$Text
  if ($env:USERPROFILE) { $s = $s.Replace($env:USERPROFILE, '<USERPROFILE>') }
  if ($env:USERNAME) { $s = $s -replace [regex]::Escape($env:USERNAME), '<USER>' }
  $s = $s -replace '(?i)(access[_-]?token|refresh[_-]?token|session(?:id)?|authorization|cookie|password|passwd|secret|ticket)=([^\s&"'']+)', '$1=<REDACTED>'
  $s = $s -replace '(?i)([?&](?:token|access_token|refresh_token|sessionid|ticket|code)=)[^&\s]+', '$1<REDACTED>'
  $s = $s -replace '[A-Fa-f0-9]{32,}', '<LONG_HEX>'
  $s = $s -replace '[A-Za-z0-9_\-]{48,}', '<LONG_TOKEN>'
  return $s
}

function Get-ProcessMap {
  $map = @{}
  foreach ($p in Get-Process) {
    $map[[int]$p.Id] = [string]$p.ProcessName
  }
  return $map
}

function Get-CandidateProcesses {
  $out = @()
  foreach ($p in Get-Process) {
    $name = [string]$p.ProcessName
    $company = $null
    $product = $null
    $description = $null
    try {
      $company = [string]$p.MainModule.FileVersionInfo.CompanyName
      $product = [string]$p.MainModule.FileVersionInfo.ProductName
      $description = [string]$p.MainModule.FileVersionInfo.FileDescription
    } catch {}
    $haystack = "$name $company $product $description"
    if (Test-InterestingText $haystack) {
      $out += [ordered]@{
        pid = [int]$p.Id
        name = Protect-Text $name
        company = Protect-Text $company
        product = Protect-Text $product
        description = Protect-Text $description
      }
    }
  }
  return @($out | Sort-Object pid -Unique)
}

function Get-LocalEndpoints {
  $proc = Get-ProcessMap
  $rows = @()

  if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
    foreach ($c in Get-NetTCPConnection) {
      $addr = [string]$c.LocalAddress
      $isLoopback = $addr -in @('127.0.0.1','::1')
      $isListener = [string]$c.State -eq 'Listen'
      $pname = $proc[[int]$c.OwningProcess]
      $candidate = Test-InterestingText $pname
      if ($isLoopback -or ($isListener -and $candidate)) {
        $rows += [ordered]@{
          protocol = 'tcp'
          localAddress = $addr
          localPort = [int]$c.LocalPort
          state = [string]$c.State
          pid = [int]$c.OwningProcess
          process = Protect-Text $pname
        }
      }
    }
  }

  if (Get-Command Get-NetUDPEndpoint -ErrorAction SilentlyContinue) {
    foreach ($c in Get-NetUDPEndpoint) {
      $addr = [string]$c.LocalAddress
      $isLoopback = $addr -in @('127.0.0.1','::1')
      $pname = $proc[[int]$c.OwningProcess]
      $candidate = Test-InterestingText $pname
      if ($isLoopback -or $candidate) {
        $rows += [ordered]@{
          protocol = 'udp'
          localAddress = $addr
          localPort = [int]$c.LocalPort
          state = $null
          pid = [int]$c.OwningProcess
          process = Protect-Text $pname
        }
      }
    }
  }

  return @($rows | Sort-Object protocol, localPort, pid -Unique)
}

function Get-SafePipeName {
  param([string]$Name)
  $s = Protect-Text $Name
  $s = $s -replace '(?i)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<GUID>'
  $s = $s -replace '\d{7,}', '<LONG_NUMBER>'
  return $s
}

function Get-InterestingPipes {
  $out = @()
  try {
    foreach ($item in Get-ChildItem -Path '\\.\pipe\') {
      $name = [string]$item.Name
      if (Test-InterestingText $name) {
        $out += (Get-SafePipeName $name)
      }
    }
  } catch {}
  return @($out | Sort-Object -Unique)
}

function Get-InterestingServices {
  $out = @()
  try {
    foreach ($s in Get-CimInstance Win32_Service) {
      $haystack = "$($s.Name) $($s.DisplayName) $($s.Description)"
      if (Test-InterestingText $haystack) {
        $out += [ordered]@{
          name = Protect-Text ([string]$s.Name)
          displayName = Protect-Text ([string]$s.DisplayName)
          state = [string]$s.State
          startMode = [string]$s.StartMode
          pid = [int]$s.ProcessId
        }
      }
    }
  } catch {}
  return @($out | Sort-Object name -Unique)
}

function Get-UriProtocols {
  $out = @()
  $roots = @('Registry::HKEY_CURRENT_USER\Software\Classes', 'Registry::HKEY_LOCAL_MACHINE\Software\Classes')
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    foreach ($key in Get-ChildItem $root) {
      $urlProtocol = Get-ItemPropertyValue -Path $key.PSPath -Name 'URL Protocol'
      if ($null -eq $urlProtocol) { continue }
      $commandPath = Join-Path $key.PSPath 'shell\open\command'
      $command = Get-ItemPropertyValue -Path $commandPath -Name '(default)'
      $name = [string]$key.PSChildName
      if (Test-InterestingText "$name $command") {
        $out += [ordered]@{
          scope = $(if ($root -like '*CURRENT_USER*') { 'user' } else { 'machine' })
          protocol = Protect-Text $name
          command = Protect-Text ([string]$command)
        }
      }
    }
  }
  return @($out | Sort-Object scope, protocol -Unique)
}

function Get-Snapshot {
  [ordered]@{
    atUtc = [DateTime]::UtcNow.ToString('o')
    candidateProcesses = @(Get-CandidateProcesses)
    localEndpoints = @(Get-LocalEndpoints)
    interestingPipes = @(Get-InterestingPipes)
    interestingServices = @(Get-InterestingServices)
  }
}

function To-KeySet {
  param($Items, [scriptblock]$Key)
  $set = @{}
  foreach ($i in @($Items)) { $set[(& $Key $i)] = $i }
  return $set
}

function Get-Delta {
  param($Before, $After)
  $epKey = { param($x) "$($x.protocol)|$($x.localAddress)|$($x.localPort)|$($x.pid)|$($x.process)" }
  $procKey = { param($x) "$($x.pid)|$($x.name)|$($x.product)" }
  $svcKey = { param($x) "$($x.name)|$($x.state)|$($x.pid)" }

  $bE = To-KeySet $Before.localEndpoints $epKey; $aE = To-KeySet $After.localEndpoints $epKey
  $bP = To-KeySet $Before.candidateProcesses $procKey; $aP = To-KeySet $After.candidateProcesses $procKey
  $bS = To-KeySet $Before.interestingServices $svcKey; $aS = To-KeySet $After.interestingServices $svcKey
  $bPipe = @{}; foreach ($x in @($Before.interestingPipes)) { $bPipe[[string]$x] = $x }
  $aPipe = @{}; foreach ($x in @($After.interestingPipes)) { $aPipe[[string]$x] = $x }

  [ordered]@{
    addedEndpoints = @($aE.Keys | Where-Object { -not $bE.ContainsKey($_) } | ForEach-Object { $aE[$_] })
    removedEndpoints = @($bE.Keys | Where-Object { -not $aE.ContainsKey($_) } | ForEach-Object { $bE[$_] })
    addedProcesses = @($aP.Keys | Where-Object { -not $bP.ContainsKey($_) } | ForEach-Object { $aP[$_] })
    removedProcesses = @($bP.Keys | Where-Object { -not $aP.ContainsKey($_) } | ForEach-Object { $bP[$_] })
    addedPipes = @($aPipe.Keys | Where-Object { -not $bPipe.ContainsKey($_) } | Sort-Object)
    removedPipes = @($bPipe.Keys | Where-Object { -not $aPipe.ContainsKey($_) } | Sort-Object)
    changedServices = @($aS.Keys | Where-Object { -not $bS.ContainsKey($_) } | ForEach-Object { $aS[$_] })
  }
}

Write-Host ''
Write-Host 'WWMSync native bridge diagnostic (READ-ONLY)' -ForegroundColor Cyan
Write-Host 'Keep Where Winds Meet running.'
Write-Host "For the next $Seconds seconds, move your character and open/close the in-game map once."
Write-Host 'No memory reads, injection, packet capture, login cookies, passwords, or tokens are collected.'
Write-Host ''

$before = Get-Snapshot
$protocols = @(Get-UriProtocols)

for ($left = $Seconds; $left -gt 0; $left--) {
  Write-Progress -Activity 'Observing safe Windows IPC surfaces' -Status "$left seconds remaining" -PercentComplete ([int](100 * ($Seconds - $left) / $Seconds))
  Start-Sleep -Seconds 1
}
Write-Progress -Activity 'Observing safe Windows IPC surfaces' -Completed

$after = Get-Snapshot
$delta = Get-Delta $before $after

$result = [ordered]@{
  schema = 'wwmsync-native-diagnostic-v1'
  generatedAtUtc = [DateTime]::UtcNow.ToString('o')
  observationSeconds = $Seconds
  machine = [ordered]@{
    os = [Environment]::OSVersion.VersionString
    architecture = $env:PROCESSOR_ARCHITECTURE
    powershell = $PSVersionTable.PSVersion.ToString()
  }
  safety = [ordered]@{
    memoryRead = $false
    injection = $false
    packetCapture = $false
    networkProbe = $false
    credentialCollection = $false
    registryWrite = $false
  }
  uriProtocols = $protocols
  before = $before
  after = $after
  delta = $delta
}

$parent = Split-Path -Parent $OutputPath
if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
$result | ConvertTo-Json -Depth 9 | Set-Content -Path $OutputPath -Encoding UTF8

Write-Host ''
Write-Host 'Diagnostic complete.' -ForegroundColor Green
Write-Host "Output: $OutputPath"
Write-Host "Changed local endpoints: $(@($delta.addedEndpoints).Count + @($delta.removedEndpoints).Count)"
Write-Host "Changed relevant pipes: $(@($delta.addedPipes).Count + @($delta.removedPipes).Count)"
Write-Host "Detected related URI protocols: $(@($protocols).Count)"
Write-Host ''
Write-Host 'Send only wwmsync-diagnostic.json back to ChatGPT for protocol analysis.'
