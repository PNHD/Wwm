[CmdletBinding()]
param(
  [string]$GameRoot = 'E:\wwm\wwm_lite',
  [int]$Seconds = 30,
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v8.json')
)

$ErrorActionPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'

# WWMSync native diagnostic v8.
# Read-only filesystem metadata delta only. No process-memory reads, injection,
# packet capture, pipe access, registry writes, credential collection, or game-file writes.

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
  $Object | ConvertTo-Json -Depth 12 | Set-Content -Path $OutputPath -Encoding UTF8
}

function Add-UniqueDir($List,[string]$Path) {
  if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Container)) { return }
  foreach($x in $List){ if([string]$x -ieq $Path){ return } }
  [void]$List.Add($Path)
}

function Get-CandidateRoots([string]$Root) {
  $out=New-Object System.Collections.ArrayList
  foreach($rel in @('LocalData','Saved','Engine\Saved','Logs','Log','logs','log','Cache','cache','UserData','Config')) {
    Add-UniqueDir $out (Join-Path $Root $rel)
  }
  if(Test-Path -LiteralPath $Root){
    foreach($d in @(Get-ChildItem -LiteralPath $Root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)(local|save|log|cache|user|config|web)' })){
      Add-UniqueDir $out $d.FullName
    }
  }
  foreach($base in @($env:LOCALAPPDATA,$env:APPDATA)){
    if(-not $base -or -not (Test-Path $base)){ continue }
    foreach($d in @(Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '(?i)(wwm|where.*winds|netease|h72)' })){
      Add-UniqueDir $out $d.FullName
      foreach($c in @(Get-ChildItem -LiteralPath $d.FullName -Directory -ErrorAction SilentlyContinue | Select-Object -First 40)){
        if($c.Name -match '(?i)(wwm|h72|save|log|cache|user|web|config)'){ Add-UniqueDir $out $c.FullName }
      }
    }
  }
  return @($out)
}

function Get-Snapshot([string[]]$Roots) {
  $map=@{}
  $count=0
  foreach($root in $Roots){
    foreach($f in @(Get-ChildItem -LiteralPath $root -File -Recurse -ErrorAction SilentlyContinue)){
      if($count -ge 60000){ break }
      if($f.Extension -match '(?i)^\.(exe|dll|pdb|pak|mpk|ucas|utoc|wem|bnk|png|jpg|jpeg|webp|dds|mp4|bk2)$'){ continue }
      $key=$f.FullName.ToLowerInvariant()
      $map[$key]=[ordered]@{
        path=Protect-Text $f.FullName
        length=[int64]$f.Length
        lastWriteUtc=$f.LastWriteTimeUtc.ToString('o')
        extension=$f.Extension
      }
      $count++
    }
  }
  return $map
}

function Get-Changed($Before,$After) {
  $out=@()
  foreach($k in $After.Keys){
    $a=$After[$k]
    if(-not $Before.ContainsKey($k)){
      $out += [ordered]@{ change='created'; path=$a.path; extension=$a.extension; beforeLength=$null; afterLength=$a.length; beforeWriteUtc=$null; afterWriteUtc=$a.lastWriteUtc }
      continue
    }
    $b=$Before[$k]
    if($a.length -ne $b.length -or $a.lastWriteUtc -ne $b.lastWriteUtc){
      $out += [ordered]@{ change='modified'; path=$a.path; extension=$a.extension; beforeLength=$b.length; afterLength=$a.length; beforeWriteUtc=$b.lastWriteUtc; afterWriteUtc=$a.lastWriteUtc }
    }
  }
  foreach($k in $Before.Keys){
    if(-not $After.ContainsKey($k)){
      $b=$Before[$k]
      $out += [ordered]@{ change='deleted'; path=$b.path; extension=$b.extension; beforeLength=$b.length; afterLength=$null; beforeWriteUtc=$b.lastWriteUtc; afterWriteUtc=$null }
    }
  }
  return @($out | Sort-Object afterWriteUtc,path)
}

$roots=@(Get-CandidateRoots $GameRoot)
$seed=[ordered]@{
  schema='wwmsync-native-diagnostic-v8'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  gameRoot=Protect-Text $GameRoot
  observationSeconds=$Seconds
  safety=[ordered]@{
    memoryRead=$false; injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false; registryWrite=$false;
    gameFileWrite=$false; filesystemMetadataRead=$true; fileContentRead=$false
  }
  roots=@($roots | ForEach-Object { Protect-Text $_ })
  beforeFileCount=0
  afterFileCount=0
  changes=@()
  summary=$null
}
Write-Json $seed
Write-Host 'WWMSync writable-state delta diagnostic v8 (READ-ONLY)' -ForegroundColor Cyan
Write-Host "Observation window: $Seconds seconds"
Write-Host 'Move the character and open/close the in-game map during this window.' -ForegroundColor Yellow

$before=Get-Snapshot $roots
$seed.beforeFileCount=$before.Count
Write-Json $seed
Start-Sleep -Seconds ([Math]::Max(1,$Seconds))
$after=Get-Snapshot $roots
$changes=@(Get-Changed $before $after)

$seed.status='complete'
$seed.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
$seed.afterFileCount=$after.Count
$seed.changes=$changes
$seed.summary=[ordered]@{
  rootCount=$roots.Count
  beforeFiles=$before.Count
  afterFiles=$after.Count
  changedFiles=$changes.Count
  created=@($changes | Where-Object {$_.change -eq 'created'}).Count
  modified=@($changes | Where-Object {$_.change -eq 'modified'}).Count
  deleted=@($changes | Where-Object {$_.change -eq 'deleted'}).Count
  sqliteLike=@($changes | Where-Object {$_.extension -match '(?i)^\.(db|sqlite|sqlite3)$'}).Count
  logLike=@($changes | Where-Object {$_.extension -match '(?i)^\.(log|txt|json|ini|cfg|xml)$'}).Count
}
Write-Json $seed
Write-Host "Complete. roots=$($seed.summary.rootCount) files=$($seed.summary.afterFiles) changes=$($seed.summary.changedFiles) sqlite=$($seed.summary.sqliteLike) logs=$($seed.summary.logLike)" -ForegroundColor Green
Write-Host "Output: $OutputPath"
