[CmdletBinding()]
param(
  [string]$DbPath = 'E:\wwm\wwm_lite\LocalData\LocalDB\db_mp',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v9.json'),
  [int]$PhaseSeconds = 12,
  [int]$SampleSeconds = 2,
  [int]$ChunkSize = 65536
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native bridge diagnostic v9.
# Read-only correlation test for the LocalData\LocalDB\db_mp file.
# It records only metadata and SHA-256 hashes of fixed-size chunks.
# It does NOT export database contents, process memory, credentials, packets,
# pipe traffic, or modify any game/user file.

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return $null }
  $s=[string]$Text
  if ($env:USERPROFILE) { $s=$s.Replace($env:USERPROFILE,'<USERPROFILE>') }
  if ($env:USERNAME) { $s=$s -replace [regex]::Escape($env:USERNAME),'<USER>' }
  return $s
}

function Write-Json($Object) {
  $parent=Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 16 | Set-Content -Path $OutputPath -Encoding UTF8
}

function New-Sha256 {
  return [System.Security.Cryptography.SHA256]::Create()
}

function Get-ChunkSnapshot([string]$Path,[int]$ChunkBytes,[string]$Phase,[int]$Ordinal) {
  $item=Get-Item -LiteralPath $Path
  $hashes=New-Object System.Collections.Generic.List[string]
  $fs=$null
  $sha=$null
  try {
    $fs = New-Object System.IO.FileStream($Path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete)
    $buffer = New-Object byte[] $ChunkBytes
    while ($true) {
      $read=$fs.Read($buffer,0,$buffer.Length)
      if ($read -le 0) { break }
      $sha=New-Sha256
      try {
        if ($read -eq $buffer.Length) {
          $digest=$sha.ComputeHash($buffer)
        } else {
          $small=New-Object byte[] $read
          [Array]::Copy($buffer,0,$small,0,$read)
          $digest=$sha.ComputeHash($small)
        }
        $hashes.Add(([BitConverter]::ToString($digest)).Replace('-',''))
      } finally {
        if ($sha) { $sha.Dispose(); $sha=$null }
      }
    }
  } finally {
    if ($fs) { $fs.Dispose() }
    if ($sha) { $sha.Dispose() }
  }

  return [ordered]@{
    atUtc=[DateTime]::UtcNow.ToString('o')
    phase=$Phase
    ordinal=$Ordinal
    length=[int64]$item.Length
    lastWriteUtc=$item.LastWriteTimeUtc.ToString('o')
    chunkSize=$ChunkBytes
    chunkCount=$hashes.Count
    chunkHashes=@($hashes)
  }
}

function Get-ChangedChunkIndexes($A,$B) {
  $out=New-Object System.Collections.Generic.List[int]
  $max=[Math]::Max([int]$A.chunkHashes.Count,[int]$B.chunkHashes.Count)
  for($i=0;$i -lt $max;$i++) {
    $ha=if($i -lt $A.chunkHashes.Count){$A.chunkHashes[$i]}else{$null}
    $hb=if($i -lt $B.chunkHashes.Count){$B.chunkHashes[$i]}else{$null}
    if($ha -ne $hb){$out.Add($i)}
  }
  return @($out)
}

function Get-PhaseStats($Transitions,[string]$Phase) {
  $selected=@($Transitions | Where-Object { $_.phase -eq $Phase })
  $set=@{}
  foreach($t in $selected) { foreach($i in $t.changedChunks) { $set[[string]$i]=$true } }
  return [ordered]@{
    phase=$Phase
    transitions=$selected.Count
    changedTransitions=@($selected | Where-Object {$_.changedChunkCount -gt 0}).Count
    uniqueChangedChunks=@($set.Keys | ForEach-Object {[int]$_} | Sort-Object)
  }
}

if($PhaseSeconds -lt 4){throw 'PhaseSeconds must be at least 4.'}
if($SampleSeconds -lt 1){throw 'SampleSeconds must be at least 1.'}
if($ChunkSize -lt 4096){throw 'ChunkSize must be at least 4096.'}
if(-not (Test-Path -LiteralPath $DbPath -PathType Leaf)){throw "db_mp not found: $DbPath"}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v9'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  dbPath=Protect-Text $DbPath
  safety=[ordered]@{
    memoryRead=$false; injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false; registryWrite=$false;
    gameFileWrite=$false; databaseWrite=$false; fileContentExport=$false;
    fileContentHashRead=$true
  }
  config=[ordered]@{ phaseSeconds=$PhaseSeconds; sampleSeconds=$SampleSeconds; chunkSize=$ChunkSize }
  snapshots=@()
  transitions=@()
  phaseStats=@()
  movementExclusiveChunks=@()
  summary=$null
}
Write-Json $state

Write-Host 'WWMSync db_mp movement correlation diagnostic v9 (READ-ONLY)' -ForegroundColor Cyan
Write-Host 'PHASE 1/3: STAND STILL. Do not move; keep the map closed.' -ForegroundColor Yellow

$phases=@('still_before','move','still_after')
$ordinal=0
$previous=$null
foreach($phase in $phases) {
  if($phase -eq 'move') {
    Write-Host 'PHASE 2/3: MOVE continuously in the game. Keep the map closed.' -ForegroundColor Green
  } elseif($phase -eq 'still_after') {
    Write-Host 'PHASE 3/3: STOP and stand still again. Keep the map closed.' -ForegroundColor Yellow
  }

  $phaseStart=[DateTime]::UtcNow
  while((([DateTime]::UtcNow)-$phaseStart).TotalSeconds -lt $PhaseSeconds) {
    $snap=Get-ChunkSnapshot $DbPath $ChunkSize $phase $ordinal
    $state.snapshots += $snap
    if($null -ne $previous) {
      $changed=@(Get-ChangedChunkIndexes $previous $snap)
      $state.transitions += [ordered]@{
        fromOrdinal=$previous.ordinal
        toOrdinal=$snap.ordinal
        phase=$phase
        atUtc=$snap.atUtc
        changedChunkCount=$changed.Count
        changedChunks=$changed
      }
    }
    $previous=$snap
    $ordinal++
    Write-Json $state
    Start-Sleep -Seconds $SampleSeconds
  }
}

$still1=Get-PhaseStats $state.transitions 'still_before'
$move=Get-PhaseStats $state.transitions 'move'
$still2=Get-PhaseStats $state.transitions 'still_after'
$state.phaseStats=@($still1,$move,$still2)

$stillSet=@{}
foreach($i in @($still1.uniqueChangedChunks)+@($still2.uniqueChangedChunks)){ $stillSet[[string]$i]=$true }
$exclusive=New-Object System.Collections.Generic.List[int]
foreach($i in $move.uniqueChangedChunks){ if(-not $stillSet.ContainsKey([string]$i)){ $exclusive.Add([int]$i) } }
$state.movementExclusiveChunks=@($exclusive | Sort-Object)

$state.status='complete'
$state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
$state.summary=[ordered]@{
  snapshots=$state.snapshots.Count
  transitions=$state.transitions.Count
  stillBeforeChangedChunks=$still1.uniqueChangedChunks.Count
  moveChangedChunks=$move.uniqueChangedChunks.Count
  stillAfterChangedChunks=$still2.uniqueChangedChunks.Count
  movementExclusiveChunkCount=$state.movementExclusiveChunks.Count
  movementExclusiveByteRanges=@($state.movementExclusiveChunks | ForEach-Object {
    [ordered]@{ chunk=[int]$_; start=[int64]($_*$ChunkSize); endExclusive=[int64](($_+1)*$ChunkSize) }
  })
}
Write-Json $state
Write-Host "Complete. snapshots=$($state.summary.snapshots) moveChunks=$($state.summary.moveChangedChunks) exclusive=$($state.summary.movementExclusiveChunkCount)" -ForegroundColor Cyan
Write-Host "Output: $OutputPath"
