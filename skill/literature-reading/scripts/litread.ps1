<#
  litread.ps1 - bootstrap one literature-reading dossier from a PDF.

  Creates  <Root>\<Key>\, where Root defaults to the folder that holds the PDF, so a
  paper and its dossier always live together (pass -Root to override):
     SOURCE.md              provenance card (hash, pages, tools, exact commands)
     text\pNNN.txt          per-page text from `pdftotext -layout` (layout preserved)
     pages\pNNN.png         rendered pages from `pdftoppm` (what the model actually reads for math)
     meta\source.json       machine-readable provenance (used by litread-page.ps1)

  Positional:  litread.ps1 <pdf-path> <key>
  Example:     litread.ps1 '<folder>\<paper>.pdf' smith2021_intersystem_crossing

  Key convention: <firstauthor><year>_<short-topic>, lower case, ascii, no spaces:
     smith2021_intersystem_crossing, chen2023_benchmark_set

  Why the PDF is staged through %TEMP%: pdftoppm/pdftotext are Windows binaries and are
  unreliable on \\wsl.localhost\ UNC paths and on non-ASCII file names ("Hall 等 - 2022 -
  ...&#xe5f8;..."). Only the staging copy lives in %TEMP%; the dossier is written next to
  the original PDF.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Pdf,
  [Parameter(Mandatory = $true, Position = 1)][string]$Key,
  [string]$Root = '',
  [string]$Render = '1-12',
  [int]$Dpi = 150,
  [switch]$NoText,
  [switch]$NoRender,
  [switch]$Force
)

$ErrorActionPreference = 'Continue'   # PS 5.1: native stderr must not become terminating; $LASTEXITCODE is checked explicitly

function Resolve-Tool {
  param([string]$Name, [string[]]$Fallbacks = @())
  $c = Get-Command $Name -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  foreach ($f in $Fallbacks) { if (Test-Path -LiteralPath $f) { return $f } }
  throw "required tool '$Name' not found on PATH; install poppler (MiKTeX ships poppler as *.exe)"
}

function Expand-PageSpec {
  param([string]$Spec, [int]$Max)
  $set = New-Object System.Collections.Generic.List[int]
  foreach ($part in ($Spec -split ',')) {
    $p = $part.Trim()
    if (-not $p) { continue }
    if ($p -match '^(\d+)\s*-\s*(\d+)$') {
      $a = [int]$Matches[1]; $b = [int]$Matches[2]
      if ($a -gt $b) { throw "bad page range '$p' (start > end)" }
      for ($i = $a; $i -le [Math]::Min($b, $Max); $i++) { $set.Add($i) }
    }
    elseif ($p -match '^(\d+)$') {
      $n = [int]$Matches[1]
      if ($n -lt 1 -or $n -gt $Max) { throw "page $n outside 1..$Max" }
      $set.Add($n)
    }
    else { throw "bad page spec '$p' (use 3, 3-7, 1-4,9)" }
  }
  return @($set | Sort-Object -Unique)
}

$miktexCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\MiKTeX\miktex\bin\x64'),
  (Join-Path $env:ProgramFiles 'MiKTeX\miktex\bin\x64'),
  (Join-Path ${env:ProgramFiles(x86)} 'MiKTeX\miktex\bin\x64')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$miktex = $miktexCandidates | Select-Object -First 1
$pdftotext = Resolve-Tool 'pdftotext.exe' @("$miktex\pdftotext.exe")
$pdftoppm  = Resolve-Tool 'pdftoppm.exe'  @("$miktex\pdftoppm.exe")
$pdfinfo   = Resolve-Tool 'pdfinfo.exe'   @("$miktex\pdfinfo.exe")

$pdfPath = (Resolve-Path -LiteralPath $Pdf).ProviderPath
if (-not (Test-Path -LiteralPath $pdfPath -PathType Leaf)) { throw "not a file: $Pdf" }
if ($Key -notmatch '^[a-z0-9][a-z0-9_\-]*$') {
  throw "key '$Key' must be lower-case ascii: [a-z0-9_-]; e.g. smith2021_intersystem_crossing"
}

# Default: the dossier lives next to the paper, i.e. <folder containing the PDF>\<Key>\
if (-not $Root) { $Root = Split-Path -Parent $pdfPath }
$dossier = Join-Path $Root $Key
if ((Test-Path -LiteralPath $dossier) -and -not $Force) {
  throw "dossier already exists: $dossier  (pass -Force to overwrite generated files)"
}
foreach ($sub in 'text', 'pages', 'meta') {
  New-Item -ItemType Directory -Force -Path (Join-Path $dossier $sub) | Out-Null
}

# --- stage a local, ASCII, space-free copy -------------------------------------------------
$stage = Join-Path $env:TEMP ("litread_" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$localPdf = Join-Path $stage 'src.pdf'
try {
  Copy-Item -LiteralPath $pdfPath -Destination $localPdf -Force

  $sha = (Get-FileHash -LiteralPath $localPdf -Algorithm SHA256).Hash.ToLowerInvariant()
  $info = (& $pdfinfo $localPdf 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) { throw "pdfinfo failed: $info" }
  $pageCount = [int]([regex]::Match($info, 'Pages:\s+(\d+)')).Groups[1].Value
  if ($pageCount -lt 1) { throw "could not read page count from pdfinfo" }
  $meta = @{}
  foreach ($fld in 'Title', 'Author', 'Subject', 'Creator', 'Producer') {
    $meta[$fld] = ([regex]::Match($info, "(?m)^${fld}:\s+(.*)$")).Groups[1].Value.Trim()
  }
  $poppler = ([regex]::Match((& $pdfinfo -v 2>&1 | Select-Object -First 1), '([0-9]+\.[0-9]+\.[0-9]+)')).Groups[1].Value

  # --- text: one pass, split on form feed ------------------------------------------------
  $textPages = 0
  if (-not $NoText) {
    $all = Join-Path $stage 'all.txt'
    & $pdftotext -layout -enc UTF-8 $localPdf $all 2>&1 | ForEach-Object { Write-Verbose $_ }
    if ($LASTEXITCODE -ne 0) { throw "pdftotext failed" }
    $raw = [System.IO.File]::ReadAllText($all, [System.Text.Encoding]::UTF8)
    $chunks = $raw -split "`f"
    for ($i = 0; $i -lt $pageCount; $i++) {
      $body = if ($i -lt $chunks.Count) { $chunks[$i] } else { '' }
      $out = Join-Path $dossier ("text\p{0:d3}.txt" -f ($i + 1))
      [System.IO.File]::WriteAllText($out, $body, (New-Object System.Text.UTF8Encoding($false)))
      if ($body.Trim().Length -gt 0) { $textPages++ }
    }
  }

  # --- pages: render the requested range -------------------------------------------------
  $rendered = @()
  if (-not $NoRender) {
    $targets = Expand-PageSpec $Render $pageCount
    foreach ($n in $targets) {
      $prefix = Join-Path $dossier ("pages\p{0:d3}" -f $n)
      & $pdftoppm -r $Dpi -f $n -l $n -png -singlefile $localPdf $prefix 2>&1 | ForEach-Object { Write-Verbose $_ }
      if ($LASTEXITCODE -ne 0) { throw "pdftoppm failed on page $n" }
      $rendered += ("pages/p{0:d3}.png" -f $n)
    }
  }

  # --- provenance ------------------------------------------------------------------------
  $stamp = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  $srcName = Split-Path -Leaf $pdfPath
  $json = [ordered]@{
    key            = $Key
    source_pdf     = $pdfPath
    source_name    = $srcName
    sha256         = $sha
    pages          = $pageCount
    title          = $meta['Title']
    author         = $meta['Author']
    subject        = $meta['Subject']
    extracted_at   = $stamp
    tools          = [ordered]@{
      poppler    = $poppler
      pdftotext  = $pdftotext
      pdftoppm   = $pdftoppm
      pdfinfo    = $pdfinfo
      render_dpi = $Dpi
    }
    commands       = [ordered]@{
      text   = "pdftotext -layout -enc UTF-8 `"$srcName`" all.txt   (split on form feed into text/pNNN.txt)"
      render = "pdftoppm -r $Dpi -f N -l N -png -singlefile `"$srcName`" pages/pNNN"
    }
    rendered_pages = $rendered
  }
  $jsonPath = Join-Path $dossier 'meta\source.json'
  [System.IO.File]::WriteAllText($jsonPath, ($json | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))

  $sourceMd = @"
# SOURCE

- key: ``$Key``
- file: ``$srcName``
- path: ``$pdfPath``
- sha256: ``$sha``
- pages: $pageCount
- title: $($meta['Title'])
- author: $($meta['Author'])
- subject: $($meta['Subject'])
- extracted: $stamp
- poppler: $poppler   (pdftotext -layout -enc UTF-8; render $Dpi dpi)

## 抽取命令（可复跑）

``````
pdftotext -layout -enc UTF-8 "$srcName" all.txt      # 按 \f 切成 text/pNNN.txt
pdftoppm  -r $Dpi -f N -l N -png -singlefile "$srcName" pages/pNNN   # 单页整页图
``````

## 已渲染页

$((($rendered | ForEach-Object { 'pages/' + [System.IO.Path]::GetFileName($_) }) -join ', '))

## 读法

- **公式**只从 ``pages/pNNN.png`` 读，不从 ``text/pNNN.txt`` 读：pdftotext 会把
  ``\sum`` ``\frac`` 上下标、希腊字母和斜体变量拆散，逐字照抄必然出错。
- **正文/表**从 ``text/pNNN.txt`` 读并引用行号，锚点写成 ``text/p003.txt:42``。
- 需要放大某个公式块时用 litread-page.ps1 -Crop，不要靠猜。
"@
  [System.IO.File]::WriteAllText((Join-Path $dossier 'SOURCE.md'), $sourceMd, (New-Object System.Text.UTF8Encoding($false)))

  # registry: key -> dossier path, so litread-page.ps1 works from any cwd
  $stateDir = Join-Path $PSScriptRoot '..\state'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $regPath = Join-Path $stateDir 'dossiers.tsv'
  $keep = @()
  if (Test-Path -LiteralPath $regPath) {
    $keep = @(Get-Content -LiteralPath $regPath -Encoding UTF8 | Where-Object { $_ -and (($_ -split "`t")[0] -ne $Key) })
  }
  $keep += ($Key + "`t" + $dossier)
  [System.IO.File]::WriteAllLines($regPath, [string[]]$keep, (New-Object System.Text.UTF8Encoding($false)))

  Write-Output "dossier : $dossier"
  Write-Output "sha256  : $sha"
  Write-Output "pages   : $pageCount   (text pages non-empty: $textPages)"
  Write-Output "rendered: $($rendered.Count) page(s) -> $Render"
  Write-Output "title   : $($meta['Title'])"
  Write-Output "next    : read pages/pNNN.png for any equation; text/pNNN.txt:LINE for prose anchors"
}
finally {
  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
}
