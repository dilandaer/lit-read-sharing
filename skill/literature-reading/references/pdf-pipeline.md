# PDF pipeline — commands, limits, and the mistakes that cost time

Everything below is tested on this machine: Windows PowerShell 5.1, poppler 24.04 bundled with
MiKTeX, PDFs living on a WSL2 UNC share.

## 1. Tools

| tool | path | use |
|---|---|---|
| `pdfinfo` | `%LOCALAPPDATA%\Programs\MiKTeX\miktex\bin\x64\` (on PATH) | page count, metadata, page size |
| `pdftotext` | same | text layer, one file per page |
| `pdftoppm` | same | render page → png, and crop |

The WSL side has `python3` but **no** PyMuPDF, pdfplumber or pypdf, and installing them is not
worth it. Do not go through WSL: poppler on the Windows side already handles UNC paths.

```powershell
pdfinfo -enc UTF-8 "C:\tmp\paper.pdf"
```

Do not use `pdfinfo -is`; it is not supported by this build. Non-ASCII locale strings in the
metadata come out as mojibake — harmless, ignore them.

## 2. Why every PDF is copied to `%TEMP%` first

Two problems, both fatal to a naive batch:

1. **UNC + non-ASCII file names.** Files named `Hall 等 - 2022 - …Properly Accounti.pdf` (the
   `等` and the truncated `…` are typical of Zotero exports) break command-line quoting, and
   some tools mangle the path before opening it.
2. **Long paths and spaces** inside `pdftoppm -o`.

`litread.ps1` therefore does `Copy-Item <src> "$env:TEMP\litread_<8hex>\src.pdf"` and works from
there, recording the original path in `meta/source.json`.

## 3. Text extraction

```powershell
pdftotext -layout -enc UTF-8 "src.pdf" "raw.txt"
# raw.txt is separated by form feeds (0x0C); page N is segment N
(Get-Content raw.txt -Raw -Encoding UTF8) -split "`f"
```

- `-layout` keeps column placement, which is what makes tables vaguely readable — but see §5.
- Without `-layout` the reading order is single-column sequential, which is *worse* for two-column
  journals but *better* for reading continuous prose. If a page is garbled, re-extract that page
  without `-layout` before giving up on text.
- A page whose `text/pNNN.txt` is empty or under ~100 characters is a scanned image. There is no
  OCR in this pipeline: say so explicitly and read that page from the png as a picture.

## 4. Rendering

```powershell
pdftoppm -r 150 -f 4 -l 4 -png -singlefile "src.pdf" "pages\p004"
```

- 150 dpi → a letter/A4 page is about 1266 × 1669 px. Prose, tables and inline chemistry are
  legible. Use this for whole pages.
- 300 dpi → about 2532 × 3338 px for a full page. Needed for stacked limits, sub/superscripts in
  fractions, and matrix elements. Crop rather than render the whole page at 300 dpi.
- Crop coordinates are in **pixels of the render you are making** — not fractions, and not a fixed
  reference resolution. `-x/-y/-W/-H` select a box in the *output* bitmap, so the same numbers that
  cover a region at 150 dpi cover a quarter of that area at 300 dpi:

```powershell
# fractions (0..1, origin top-left) of the page box, measured on the 150-dpi page
$dpi = 300; $k = $dpi / 150
$x = [int]($x0 * $w150 * $k); $y = [int]($y0 * $h150 * $k)
$W = [int](($x1-$x0) * $w150 * $k); $H = [int](($y1-$y0) * $h150 * $k)
pdftoppm -r $dpi -f $n -l $n -x $x -y $y -W $W -H $H -png -singlefile "src.pdf" "pages\p004_z"
```

The one-line check for this: render the same `-W 400` at `-r 150` and at `-r 300`. Both files are
400 px wide — that is the tell that the box is in output pixels, not source pixels. If you measured
on the 150-dpi page and pass those numbers to `-r 300`, every crop comes out half-size.
`litread-page.ps1` sidesteps the trap by rendering a full page at the target `-Dpi` first and
measuring *that* bitmap, so `-Box` fractions are right at any dpi; prefer it over hand-rolled commands.

Rendering budget: 150 dpi ≈ 150–600 KB per page. A 123-page SI rendered whole is ~40 MB and
minutes of IO. Render the twelve pages you will actually read, then PAGE on demand.

## 5. Two-column interleaving (the trap that corrupts quotes)

`pdftotext -layout` on a two-column journal page emits **both columns on the same text line**:

```
SCS-CC2/cc-pVDZ is used, as well as with TD-DFT and                  The primary reason for the
Coulomb correlation.                                                  failure of DFT methods lies in
```

The lines are ordered left-to-right across the whole page, so a single line can contain the end
of a left-column sentence and the start of a right-column one. Consequences:

- A line-number anchor `text/p004.txt:41` may point at a line holding two different sentences.
  Quote the sentence, not just the line number.
- Column order in the file is **not** reading order. Never reconstruct an argument from a text
  dump of a two-column paper; if the argument matters, read `pages/pNNN.png`.
- Tables with merged cells come out as unrelated number soup. Tables are image-only.
- Sniff the problem cheaply: if a line is longer than ~110 characters, or a line ends mid-clause
  and the next starts with a capital that clearly belongs elsewhere, assume interleaving.

## 6. Math is image-only

`pdftotext` on an equation region yields something like `E ST = E S1( ) − E T1( )` — the operator
structure, the fractions and the equation number are all gone, and `1` and `l`, `O` and `0`, `−`
and `-` are unreliable. Every equation, subscript, matrix and Greek symbol in DERIVATION.md must
come from the png. When an equation number is needed, read it off the png too; do not infer it
from position in the text.

## 7. Page numbering

Three different numbers coexist and all three get cited:

- PDF page index (what `-f`/`-l` take, what `text/pNNN.txt` and `pages/pNNN.png` use)
- printed journal page (e.g. 4906, appears in headers/footers)
- manuscript section number (§2.1, SI §S4.1.1)

Always write the PDF page with the anchor and add the printed page when quoting. A bare "p. 4"
is ambiguous in a 16-page article that starts at journal page 4903.

## 8. Quick command set (copy-paste)

```powershell
$S = "%DSH_HOME%\skills\literature-reading\scripts"
# 1. dossier: metadata + per-page text + first 12 pages rendered
pwsh -NoProfile -File "$S\litread.ps1" -Pdf "<pdf>" -Key <key> -Render "1-12"
# 2. a later page, full, 150 dpi
pwsh -NoProfile -File "$S\litread-page.ps1" -Key <key> -Page 14
# 3. a crop at 300 dpi for one equation block
pwsh -NoProfile -File "$S\litread-page.ps1" -Key <key> -Page 4 -Dpi 300 -Box 0.06,0.55,0.5,0.85
# 4. find where an equation number appears in the text layer (then confirm on the png)
Select-String -Path "lit_reading\<key>\text\*.txt" -Pattern '\(7\)' | Select-Object -First 5
```

## 9. Troubleshooting

| symptom | cause | action |
|---|---|---|
| `text/pNNN.txt` empty | scanned page | read the png; state "该页无文本层" |
| every line ~150 chars, sentences split | two-column `-layout` | re-extract without `-layout`, or read png |
| ligatures: `ﬁ`, `ﬂ`, `ﬀ` | font encoding | normalize in your notes; do not grep on them |
| `−` (U+2212) vs `-` vs `–` | typography | normalize to `-` before pattern matching |
| `pdftoppm` writes `p004-1.png` | `-singlefile` missing | always pass `-singlefile` |
| crop offset wrong / crop half-size | box given as fractions, or measured at one dpi and rendered at another | scale by `dpi/150`; a 400-px box at `-r 150` and `-r 300` is the same 400 px wide but not the same area |
| PDF opens but renders blank | page rotation / crop box | render whole page, inspect; note it in SOURCE.md |
