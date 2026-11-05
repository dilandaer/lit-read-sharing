<#
.SYNOPSIS
  Install the `literature-reading` skill (and optionally its DSH agent preset) for the current user.

.DESCRIPTION
  Copies skill/literature-reading into <DshHome>\skills\literature-reading, then regenerates the
  `litreading` agent-preset entry in <DshHome>\profiles\<Profile>\cordis.patch.yml from the
  persona text shipped with the skill. Safe to re-run: an existing skill dir is backed up first,
  and the preset entry is replaced in place (never duplicated).

.PARAMETER DshHome
  DSH home directory. Defaults to $env:DSH_HOME, else %USERPROFILE%\.dsh

.PARAMETER Profile
  Profile name. Defaults to $env:DSH_PROFILE, else 'desktop'

.PARAMETER SkipPreset
  Only install the skill; leave the cordis patch untouched.

.PARAMETER SkipAgents
  Do not touch %USERPROFILE%\.dsh\AGENTS.md

.PARAMETER Force
  Overwrite the skill dir without keeping a backup.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install\install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install\install.ps1 -SkipPreset
#>
[CmdletBinding()]
param(
  [string]$DshHome = $(if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }),
  [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
  [switch]$SkipPreset,
  [switch]$SkipAgents,
  [switch]$Force
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
$srcSkill = Join-Path $repo 'skill\literature-reading'
$dstSkill = Join-Path $DshHome 'skills\literature-reading'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

function Say($msg) { Write-Host "==> $msg" }
function Warn($msg) { Write-Host "--  $msg" -ForegroundColor Yellow }
function Die($msg) { Write-Host "!!  $msg" -ForegroundColor Red; exit 1 }

Say "repo      : $repo"
Say "DSH home  : $DshHome (profile: $Profile)"

if (-not (Test-Path -LiteralPath $srcSkill)) { Die "skill payload not found: $srcSkill" }

# ---- 1. prerequisites -------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Die "node not found on PATH (needed by the checker / math / preset scripts)" }
Say ("node      : " + (& node --version))

$poppler = @('pdftotext.exe', 'pdftoppm.exe', 'pdfinfo.exe') | ForEach-Object {
  $null -ne (Get-Command $_ -ErrorAction SilentlyContinue)
}
if ($poppler -contains $false) {
  Warn "poppler not fully on PATH (pdftotext/pdftoppm/pdfinfo). The skill needs it to build dossiers."
  Warn "Install MiKTeX (bundles poppler) or poppler-windows, then re-open the shell."
} else {
  Say "poppler   : ok"
}

$yamlPath = Join-Path $DshHome "profiles\$Profile\node_modules\yaml"
if (-not $SkipPreset) {
  if (-not (Test-Path -LiteralPath $yamlPath)) {
    Warn "yaml module not found at $yamlPath — the preset step needs it."
    Warn "Either run 'npm i yaml' inside $DshHome\profiles\$Profile, or re-run with -SkipPreset."
  }
}

# ---- 2. skill files ---------------------------------------------------------
if ((Test-Path -LiteralPath $dstSkill) -and -not $Force) {
  $bak = "$dstSkill.bak-$stamp"
  Say "backing up existing skill -> $bak"
  Move-Item -LiteralPath $dstSkill -Destination $bak
}
if (Test-Path -LiteralPath $dstSkill) { Remove-Item -LiteralPath $dstSkill -Recurse -Force }
New-Item -ItemType Directory -Path $dstSkill -Force | Out-Null
Copy-Item -Path (Join-Path $srcSkill '*') -Destination $dstSkill -Recurse -Force
Say "skill     : installed -> $dstSkill"

# keep a registry file, do not overwrite an existing one
$reg = Join-Path $dstSkill 'state\dossiers.tsv'
if (-not (Test-Path -LiteralPath $reg)) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $reg) -Force | Out-Null
  Set-Content -LiteralPath $reg -Value '# key<TAB>dossier-path   - one line per paper, appended by scripts/litread.ps1' -Encoding UTF8
}

# ---- 3. AGENTS.md (opt-in, append-only) ------------------------------------
if (-not $SkipAgents) {
  $agents = Join-Path $DshHome 'AGENTS.md'
  $marker = '<!-- literature-reading: math rendering -->'
  $snippet = Join-Path $repo 'install\AGENTS.md.snippet'
  $has = (Test-Path -LiteralPath $agents) -and ((Get-Content -LiteralPath $agents -Raw -Encoding UTF8) -like "*$marker*")
  if ($has) {
    Say "AGENTS.md : snippet already present, skipped"
  } elseif (Test-Path -LiteralPath $snippet) {
    $body = Get-Content -LiteralPath $snippet -Raw -Encoding UTF8
    if (Test-Path -LiteralPath $agents) { Copy-Item -LiteralPath $agents -Destination "$agents.bak-$stamp" -Force }
    [System.IO.File]::AppendAllText($agents, $body + "`r`n" + $marker, (New-Object System.Text.UTF8Encoding($false)))
    Say "AGENTS.md : snippet appended (math rendering rules for every session)"
  }
}

# ---- 4. preset --------------------------------------------------------------
if ($SkipPreset) {
  Warn "preset    : skipped (-SkipPreset); the mode will not appear in the UI"
} else {
  Say "preset    : generating entry"
  $env:DSH_HOME = $DshHome
  $env:DSH_PROFILE = $Profile
  & node (Join-Path $dstSkill 'scripts\update-preset.js')
  if ($LASTEXITCODE -ne 0) { Die "preset generation failed (exit $LASTEXITCODE); patch left as it was" }
}

# ---- 5. verify --------------------------------------------------------------
Say "verifying skill"
& node (Join-Path $dstSkill 'scripts\selftest.js')
if ($LASTEXITCODE -ne 0) { Warn "selftest reported failures (see above)" } else { Say "selftest  : PASS" }

Write-Host ""
Say "done. Next:"
Write-Host "   1. In DSH: open Settings > General (or the New Session screen) and pick the mode"
Write-Host "      'Literature co-reader'. New sessions only; already-open sessions keep their prompt."
Write-Host "   2. No mode needed: just ask for 'skill literature-reading' in any session."
Write-Host "   3. Restart DSH if the mode does not show up."
