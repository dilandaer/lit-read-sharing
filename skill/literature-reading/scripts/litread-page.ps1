<#
  litread-page.ps1 - re-render one page of a dossier's source PDF, optionally zoomed into a box.

  Use it when a full-page render is not enough to read a formula: the subscripts, the
  superscript indices and the operator under a sum are what you are actually trying to copy,
  and guessing them is how fabricated equations happen.

  Examples
    litread-page.ps1 -Key smith2021_intersystem_crossing -Page 5                 # 整页, 300 dpi
    litread-page.ps1 -Key smith2021_intersystem_crossing -Page 5 -Box 0,0.30,0.55,0.62
                                                                   # 只渲染页面左栏中段
    litread-page.ps1 -Key chen2023_benchmark_set -Page 3 -Box 0.05,0.55,0.95,0.85 -Dpi 400

  -Box takes page fractions x0,y0,x1,y1 of the FULL rendered page (origin top-left,
  y downward), so it does not depend on the PDF's point geometry or rotation.

  Output: pages/pNNN.png  (整页)  or  pages/pNNN_z.png  (裁剪块), path printed on stdout.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Key,
  [Parameter(Mandatory = $true)][int]$Page,
  [string]$Root = '',
  [int]$Dpi = 300,
  [string[]]$Box = @()
)

$boxSpec = (@($Box) -join ',')

$ErrorActionPreference = 'Continue'   # PS 5.1: native stderr must not become terminating; $LASTEXITCODE is checked explicitly

function Resolve-Tool {
  param([string]$Name, [string[]]$Fallbacks = @())
  $c = Get-Command $Name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($f in $Fallbacks) { if (Test-Path -LiteralPath $f) { return $f } }
  throw "required tool '$Name' not found on PATH; install poppler (MiKTeX ships poppler as *.exe)"
}

$miktexCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\MiKTeX\miktex\bin\x64'),
  (Join-Path $env:ProgramFiles 'MiKTeX\miktex\bin\x64'),
  (Join-Path ${env:ProgramFiles(x86)} 'MiKTeX\miktex\bin\x64')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$miktex = $miktexCandidates | Select-Object -First 1
$pdftoppm = Resolve-Tool 'pdftoppm.exe' @("$miktex\pdftoppm.exe")

function Resolve-Dossier {
  param([string]$Key, [string]$Root)
  $candidates = New-Object System.Collections.Generic.List[string]
  if ($Root) { $candidates.Add((Join-Path $Root $Key)) }
  $regPath = Join-Path $PSScriptRoot '..\state\dossiers.tsv'
  if (Test-Path -LiteralPath $regPath) {
    foreach ($line in Get-Content -LiteralPath $regPath -Encoding UTF8) {
      $parts = $line -split "`t"
      if ($parts.Count -ge 2 -and $parts[0] -eq $Key) { $candidates.Add($parts[1]) }
    }
  }
  $cwd = (Get-Location).ProviderPath
  $candidates.Add((Join-Path $cwd $Key))
  $candidates.Add((Join-Path $cwd "lit_reading\$Key"))
  foreach ($c in $candidates) {
    if (Test-Path -LiteralPath (Join-Path $c 'meta\source.json')) { return $c }
  }
  throw "dossier '$Key' not found. Tried: $($candidates -join ' | '). Pass -Root <folder containing <Key>>."
}

$dossier = Resolve-Dossier -Key $Key -Root $Root
$jsonPath = Join-Path $dossier 'meta\source.json'
if (-not (Test-Path -LiteralPath $jsonPath)) { throw "no dossier at $dossier (run litread.ps1 first)" }
$meta = Get-Content -LiteralPath $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$src = $meta.source_pdf
if (-not (Test-Path -LiteralPath $src)) { throw "source PDF no longer present: $src" }

$stage = Join-Path $env:TEMP ("litread_" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$localPdf = Join-Path $stage 'src.pdf'
try {
  Copy-Item -LiteralPath $src -Destination $localPdf -Force

  # pass 1: full page, to learn the pixel geometry at this dpi
  $full = Join-Path $stage 'full'
  & $pdftoppm -r $Dpi -f $Page -l $Page -png -singlefile $localPdf $full
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path "$full.png")) { throw "pdftoppm failed on page $Page" }
  Add-Type -AssemblyName System.Drawing
  $img = [System.Drawing.Image]::FromFile("$full.png")
  $W = $img.Width; $H = $img.Height; $img.Dispose()

  $pagesDir = Join-Path $dossier 'pages'
  New-Item -ItemType Directory -Force -Path $pagesDir | Out-Null

  if (-not $boxSpec) {
    $out = Join-Path $pagesDir ("p{0:d3}.png" -f $Page)
    Copy-Item -LiteralPath "$full.png" -Destination $out -Force
    Write-Output $out
    Write-Output ("# full page {0} at {1} dpi  ({2}x{3} px)" -f $Page, $Dpi, $W, $H)
    return
  }

  if ($boxSpec -notmatch '^\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*$') {
    throw "bad -Box '$boxSpec'; expected x0,y0,x1,y1 as page fractions 0..1 (e.g. 0,0.3,0.55,0.62)"
  }
  $x0, $y0, $x1, $y1 = [double]$Matches[1], [double]$Matches[2], [double]$Matches[3], [double]$Matches[4]
  foreach ($v in $x0, $y0, $x1, $y1) { if ($v -lt 0 -or $v -gt 1) { throw "-Box fractions must lie in 0..1" } }
  if ($x1 -le $x0 -or $y1 -le $y0) { throw "-Box needs x1>x0 and y1>y0" }

  $px = [int][Math]::Floor($x0 * $W); $py = [int][Math]::Floor($y0 * $H)
  $pw = [int][Math]::Ceiling(($x1 - $x0) * $W); $ph = [int][Math]::Ceiling(($y1 - $y0) * $H)
  $outPrefix = Join-Path $pagesDir ("p{0:d3}_z" -f $Page)
  & $pdftoppm -r $Dpi -f $Page -l $Page -x $px -y $py -W $pw -H $ph -png -singlefile $localPdf $outPrefix
  if ($LASTEXITCODE -ne 0) { throw "pdftoppm crop failed" }
  Write-Output "$outPrefix.png"
  Write-Output ("# crop of page {0} at {1} dpi: box {2},{3},{4},{5} of {6}x{7} px -> {8}x{9} px" -f $Page, $Dpi, $x0, $y0, $x1, $y1, $W, $H, $pw, $ph)
}
finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
