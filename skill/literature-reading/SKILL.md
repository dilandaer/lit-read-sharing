---
name: literature-reading
description: >
  Co-reads one paper with a theoretical-chemistry researcher instead of summarizing it:
  freezes the scientific question, rebuilds the theory line and every numbered equation,
  keeps a symbol / approximation / convention ledger, and attacks the argument for hidden
  assumptions and open problems. Output is written into a per-paper dossier that sits next to
  the source PDF (`<paper-folder>/<key>/`) as 骨架卡 / 符号表 / 公式复现 / 批判性审查, with every claim anchored
  to a page. Also produces full section-by-section translations of a paper or its SI
  (翻译这一节 / translate section N) with a coverage table and per-section notes.
  Use when the user says 精读这篇文献, 一起读文献, 读懂这篇文章的理论,
  这篇文章的公式怎么来的, 帮我理清这篇的思路, 翻译这一节, 把这节翻译出来, translate section N,
  or hands over a PDF / DOI / arXiv id and wants
  to learn from it. Do not use for a bare summary request ("这篇讲了什么", 三句话总结) or for
  pulling numbers out of many papers into one table — those are the summary and lit_extract routes.
argument-hint: "<pdf-path | DOI | arXiv-id> [key]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, PowerShell, Skill(formula-derivation)
---

# Literature Reading: Co-Reading Mode

A paper is read to *reconstruct* it, not to restate it. The end state is that the user can
close the PDF and re-derive the central result, say which approximation carries the physics,
and name one thing the authors did not show. Anything short of that is a summary.

The user works on electronic structure at research level. Assume the standard toolbox — wavefunction
and density-functional methods, multireference treatment, embedding / fragmentation, spin-orbit
coupling, non-adiabatic dynamics — is already known. Do not spend words on textbook definitions
unless the paper redefines them. Spend the words on *this* paper's logic: why these equations, why
this quantity, what breaks first.

## Constants

- `SKILL_DIR = %DSH_HOME%\skills\literature-reading`
- `SETUP = $SKILL_DIR\scripts\litread.ps1` — pdf → dossier (per-page text, rendered pages, sha256 manifest)
- `PAGE = $SKILL_DIR\scripts\litread-page.ps1` — re-render one page, or one crop, at high dpi
- dossier root default = **the folder that holds the PDF** (a paper and its dossier always sit
  together; override with `-Root`). Never park a dossier in a scratch/work directory.
- key convention = `<firstauthor><year>_<topic-slug>`, lowercase, `^[a-z0-9][a-z0-9_\-]*$`
  (e.g. `smith2021_intersystem_crossing`; never `paper1`, never a path fragment)

Dossier layout — first four entries come from SETUP, the rest are written by this skill:

```
<paper-folder>/<key>/          # next to the source PDF
  SOURCE.md          sha256, page count, "read equations from the png" note
  meta/source.json   machine record: source path, hash, tools, rendered pages
  text/pNNN.txt      pdftotext -layout, one file per page
  pages/pNNN.png     rendered pages — the only trustworthy source for math
  pages/pNNN_z.png   high-dpi crop produced by PAGE
  CARD.md  SYMBOLS.md  DERIVATION.md  CRITIQUE.md
<workspace>/lit_reading/INDEX.md       cross-paper ledger (points at each dossier's real path)
<workspace>/lit_reading/QUESTIONS.md   open scientific questions harvested while reading
```

SETUP records every dossier in `state\dossiers.tsv`, so PAGE finds `<key>` from any cwd.

Two references are load-bearing, not decoration:

- `references/pdf-pipeline.md` — the exact poppler commands behind SETUP/PAGE, the dpi/crop
  arithmetic, and the PDF traps already hit (UNC + non-ASCII filenames, `-layout` two-column
  interleaving, why equations never come from text).
- `references/theoretical-chemistry-checklist.md` — the per-domain list of things that silently
  ruin a comparison (reference state and spin, basis and frozen core, vertical vs adiabatic,
  state-specific vs linear response, solvent, unit conversions; embedding and exciton specifics).
  Run it against §5 of the CARD and against any table you intend to quote.

## Writing into the dossier (UNC shares and virtiofs mounts)

Some workspaces live on `\\wsl.localhost\Ubuntu-22.04\...`, a virtiofs mount. `read` works there,
but the `write` and `edit` tools fail with
`ENOTSUP: operation not supported ... link '.CARD.md.xxx.tmpdir\CARD.md.tmp' -> 'CARD.md'`
because their atomic write uses a hardlink the mount does not implement.

So write markdown **locally first, then copy** (on a plain NTFS dossier folder, write directly):

```
# 1. write/rewrite the document under %TEMP%\litread_out\<key>\CARD.md
# 2. copy it into place (destination = the folder that holds the PDF)
Copy-Item "<local md>" -Destination "<paper-folder>\<key>\CARD.md" -Force
# 3. read it back once to confirm the Chinese text and the tables survived
```

`Copy-Item` is byte-exact. Never round-trip through `Get-Content | Set-Content` — on this share it
can rewrite encoding and line endings, which quietly corrupts a document full of symbols.

## Output rendering — equations in chat and in the dossier

Getting this wrong costs whole messages: the DSH chat renderer accepts inline `$ … $` and
**single-line** `$$ … $$` only. A multi-line `$$` block, or `\[ … \]`, makes the rest of the
message degrade to literal source (measured against the shipped bundle; mechanism, verified
table and per-symptom fix: `references/dsh-chat-rendering.md`).

1. `$ … $` inline by default.
2. A display equation is one physical line: `$$ <math> $$` — matrices included.
3. Never `$$` alone on its own line, never `\[ … \]`, never `\( … \)`.
4. No display math inside a table cell.
5. Long derivations live in the dossier file. The chat message keeps at most three one-line
   display equations: the definition, the step that carries the physics, the result.
6. After writing a math-heavy `.md`, run
   `node "%DSH_HOME%\skills\literature-reading\scripts\normalize-math.js" <file-or-dir> --write`
   and get exit code 0 before calling the file finished.

## Section translation — no omissions（逐段逐式全译，不得遗漏）

When the user says 翻译这一节 / "translate section N", the deliverable is a **full section-by-section
translation**, not a summary. The failure mode is silent compression: four equations collapsed into
"and three more of the same form", a footnote dropped, a limiting clause ("valid only when…")
paraphrased away, a table's cell labels lost. This has already happened once — a supplementary
section arrived with four equations described instead of written, a long summation reduced to one
sample term, and two equations skipped outright — and the reader caught it. Do not repeat.

1. **Coverage is by number, not by impression.** Every numbered equation, table, figure, caption and
   footnote in the range must appear with its own number. Sections get a heading in the translation.
2. **Long sums are transcribed whole.** If (35)–(42) differ only in phonon labels, write all eight.
   Never write "其余结构相同" or "余类似". One physical line per display equation.
3. **Prose is translated, not distilled.** Keep the limiting clauses, the bracketed citations, and
   the sentences where the authors admit a failure — that is the content, not decoration.
4. **Tables are cell-by-cell, with the full caption and every footnote (a)(b)(c)…** Footnote text is
   often where a number turns out to be a fitted parameter.
5. **Start the file with a coverage table** (`原文位置 → 本节小节`), then run both checks before
   calling it done and paste their output in the reply:
   `node "<skill>/scripts/check-translation-coverage.js" --source <dossier>/text --from pNNN:L --to pNNN:L --translation <file>`
   → exit 0; `node "<skill>/scripts/normalize-math.js" <file> --write` → exit 0.
6. **Uncertain glyph → mark it, keep the equation.** `[unreadable: …]` or a 译者注 naming the page.
   Dropping an equation is never the fix.

## Four laws

1. **No anchor, no claim.** Every statement about the paper carries `text/pNNN.txt:NNN` and,
   when the printed page differs from the PDF page, the printed page too (PDF page 4 is journal
   page 4906). A number without an anchor is marked `未核实`. Never smooth over a page you did
   not open.
2. **Equations come from pixels.** `pdftotext` destroys fractions, super/subscripts, bras and
   kets, matrix structure and equation numbers. Transcribe math only from `pages/pNNN.png`,
   cropping with PAGE when small. If a glyph is genuinely ambiguous write
   `[unreadable: <symbol>, candidates A/B]` and keep going. Never guess silently.
3. **Separate the paper from your reading of it.** Tag load-bearing sentences `(paper)` /
   `(inferred)` / `(objection)`. Blurring these is how an honest critique becomes fiction.
4. **Reading is a dialogue, not a dump.** Stop at each checkpoint with at most three questions
   and wait for the answer. Producing all four documents before the user has agreed on the
   skeleton is a failure of this mode, not thoroughness.

## Workflow routing

| request | mode | produced |
|---|---|---|
| "这篇值不值得读", triage a folder, one-sentence verdict | **quick** | CARD.md skeleton only (§0–§3, ≤1 page) + INDEX row |
| "精读", "一起读", "读懂理论", no qualifier | **full** | CARD → SYMBOLS → DERIVATION → CRITIQUE, gated at each checkpoint |
| "这个公式怎么来的", "这一步为什么成立", one stuck point | **point** | answer inline + append to the file that owns it |
| two or more papers on one question | **compare** | INDEX.md rows + a comparison table in QUESTIONS.md; read each paper's 口径 before comparing |
| "翻译这一节", "translate section N", the SI has to be read line by line | **translate** | `TRANSLATION_S<N>.md` — 逐段逐式全译 + 覆盖表 + 译者注 + 与正文对应表 |

- `quick` renders no equations and never opens CRITIQUE.md. Its job is to decide whether the
  paper deserves a week.
- `full` runs the steps in order but **stops after Step 1** for confirmation. If the user says
  continue, continue; if the skeleton was all they wanted, stop there.
- `point` does not restart the dossier: read `SYMBOLS.md` first. Most stuck points are a
  notation collision or an unstated approximation, not a missing derivation.

## Step 0 — dossier

If `<paper-folder>/<key>/` already exists, read `SOURCE.md` and use it. Never re-run SETUP without
`-Force`. Otherwise (the dossier is created next to the PDF automatically):

```
powershell -NoProfile -File "%DSH_HOME%\skills\literature-reading\scripts\litread.ps1" `
  -Pdf "<pdf>" -Key <key> -Render "1-12"
```

Render only the pages you expect to need (front matter, conclusion, pages where equations
live); use PAGE for anything later. A page png is 150–600 KB — do not render 120 pages "just in
case". The SI is its own dossier (`<key>_si`) cross-linked from both SOURCE.md files. Never
blend main-text and SI conventions in one table.

For a DOI or arXiv id, metadata may be fetched to pick the key, but the reading happens on a
real PDF. If there is no PDF, say so and offer `quick` on the abstract with an explicit
"只读了摘要" warning.

## Step 1 — CARD.md (骨架卡)

Template: `templates/CARD.md`. Depth over coverage, one to two pages.

- **§1 科学问题** is a gap, not a topic. Bad: "研究了⟨某方法⟩对⟨某量⟩的计算". Good:
  "⟨某方法⟩已被广泛用于⟨用途⟩，但⟨某量⟩系统性偏离；作者要判定偏差来自⟨假设 A⟩还是
  ⟨假设 B⟩". A topic cannot be solved; a gap can.
- **§3 核心 claim** is a numbered list of falsifiable sentences (C1, C2, …) each with its
  evidence type: 数值证据 / 解析推导 / 引用 / 直觉. A claim without an evidence type is not a claim.
- **§5 关键结论与数量级** carries units and a comparison point ("MAD 0.04 eV vs 实验",
  "−0.219 eV，约为同类基准体系的 1.7 倍"). A bare number is useless six months later.
- **§6 局限** is what the authors admit. **§7 我还不确定** is what you do not. Keep them apart.

Then show the user §1–§3 and stop. Their agreement decides whether the rest is worth doing.

## Step 2 — SYMBOLS.md (符号 / 近似 / 口径)

Four tables, `templates/SYMBOLS.md`. Cheap to build, and it is what makes papers inside one
folder comparable, so never skip it in `full`.

1. **符号表** — symbol | meaning | unit | first appearance (anchor) | redefined later?
   Mark with ⚠ any symbol that changes meaning mid-paper or that another paper in the folder
   uses for something else.
2. **近似清单** — # | approximation | entering equation | what it drops | when it fails |
   discussed by the authors? One approximation per row, never merged. This is the highest-value
   table in the skill.
3. **口径核对** — reference state and spin; geometry source (XRD / optimized, at which level);
   basis set and frozen core; vertical vs adiabatic; state-specific vs linear response; solvent
   model; unit system; **sign convention of every gap** (is ΔEST = E(S1)−E(T1) or the reverse);
   gauge / origin; energy zero. A reversed sign convention is the most common cross-paper error.
4. **一致性自检** — recompute what is recomputable: ΔE from tabulated E(S1) and E(T1); unit
   conversions (1 Ha = 27.211386 eV, 1 eV = 8065.54 cm⁻¹, 1 Ha = 219474.63 cm⁻¹); whether the
   abstract's headline number is actually supported by the tables. If the paper's own numbers do
   not reproduce, that is a finding — record it loudly.

Before closing the file, walk `references/theoretical-chemistry-checklist.md` section by section:
every item it names that this paper uses must have a row in one of the four tables. Items the
paper leaves unspecified are themselves findings — mark them `未说明` rather than skipping.

## Step 3 — DERIVATION.md (公式逐条复现)

Template: `templates/DERIVATION.md` (formula map table + the per-equation block below).

Build a **公式地图** first, from the png: one row per numbered equation —
Eq. | purpose | inputs | output goes to | used later? An equation that is never used again is
usually decoration; say so.

Then walk the equations that carry the argument (not all forty). For each:

```
### Eq. (7) — <what it does>
原文: <LaTeX transcribed from pNNN.png>     [p. 4906, text/p004.txt:41]
复现: <your own derivation, step by step>
步型: identity | proposition | approximation | interpretation
检查: 量纲 / 极限 / 厄米性或守恒 / 与文中数值抽查
状态: REPRODUCED | REPRODUCED WITH CORRECTION | GAP
```

The four step types are borrowed from `formula-derivation` on purpose: labelling a step
`approximation` is what forces the questions "drops what, valid when".

A `GAP` row must name which of three things is missing: a definition, a reference, or an
algebraic step. "无法复现" alone is worthless. Gaps are the seed corn of QUESTIONS.md.

If the user wants a paper-grade derivation document, hand off to `Skill(formula-derivation)`.
DERIVATION.md then keeps only the entry point and the gap list.

## Step 4 — CRITIQUE.md (批判性审查)

Template: `templates/CRITIQUE.md`. Five blocks.

- **隐藏假设** — used but never stated: frozen geometry, single conformer, neglected spin
  contamination, a functional tuned on the same test set, a converged-looking unconverged basis.
- **论证类型** — per core claim: proof / numerical evidence / analogy / intuition. A claim
  argued by intuition but stated as a result deserves a full paragraph.
- **没有展示的东西** — scans, convergence, error bars, negative controls, systems that were
  dropped. Absence is evidence.
- **适用范围** — one sentence of the form "在 … 范围内成立". No scope statement, no critique.
- **可推广方向** — change system / method / regime; state what you would predict and what would
  falsify it. No prediction, no entry.

Do not manufacture objections. If the paper is solid, the honest output is "两处隐藏假设，都不
影响主结论" — that is a result the user can act on.

## Step 5 — dialogue checkpoints

After each step ask at most three questions, one from each level:

- 复述: "用自己的话说，作者为什么必须引入双激发？" — does the user own the logic.
- 预测: "按 Eq.(7)，基组继续加大会让 ΔEST 往哪走？" — ask *before* revealing the answer.
- 反例: "什么样的体系会让这条近似立刻崩？"

Record the answers and any unresolved thread in `QUESTIONS.md` or CARD §7, not only in chat.
Never answer your own prediction question in the same message.

## Ledgers

`INDEX.md` — template: `templates/INDEX.md`. One row per paper: key | title | year | problem domain | status (骨架/全读) |
一句话值不值得读 | strongest anchor. Written on first contact, updated when status changes. This
is how a folder of forty PDFs becomes a map instead of a pile.

`QUESTIONS.md` — template: `templates/QUESTIONS.md`. The "寻找需要解决的科学问题" ledger. One row per question:
Q-id | 来源 (key + anchor) | 类型 (概念缺口 / 方法缺口 / 数据冲突 / 可推广) | 我的初步想法 |
状态 (open / answered / dropped). Only questions a paper actually generated — never generic
"future work" filler.

## Anchoring format

- text: `text/p004.txt:41`, plus `p. 4906` when the printed page differs from the PDF page
- equation: `[p004.png, Eq.(7)]`
- table / figure: `[p005.png, Table 2]` — tables are read from the image, not from text
- provenance: sha256 first 16 chars from `meta/source.json` when quoting a number

## Anti-patterns

- Transcribing equations from `text/*.txt`.
- Rewriting the abstract in Chinese and calling it a 骨架卡.
- "显然 / 易得 / similarly" as a derivation step.
- Inventing an equation number without opening the png.
- Mixing SI and main-text conventions, or two papers' gap sign conventions, in one table.
- Writing display math across lines (`$$` alone on a line, or `\[ … \]`) in the chat body or
  in a dossier file — see "Output rendering".
- Writing all four documents in one shot before the skeleton is agreed.
- Compressing a translation: "式 (35)–(42) 结构相同，故只给出 (35)(36)" / dropping a footnote / 概述一段
  承认局限的原文. In `translate` mode this is treated as an incomplete deliverable.
- Explaining what TD-DFT is. The user knows. Explain why *this* paper needs SCS.

## Completion

Report in the user's language:

1. 一句话：这篇在解决什么，结论有多硬。
2. 现在停在哪一步，哪些文件已写入（绝对路径）。
3. 下一个 checkpoint 的问题（≤3 条）。
4. 未核实项清单，一行为一条。
5. 公式渲染自检：消息里每个独立公式都在单行内闭合；写完的文档跑过
   `normalize-math.js` 且为 exit 0。
6. 若本轮是 `translate`：`check-translation-coverage.js` 必须 exit 0（公式/表图/标题 全 OK），
   并在回复里给出覆盖率那一行输出。

Never call a document finished while it still contains unanchored numbers or unreported gaps.

## Self-checks after editing this skill

Nothing in this folder is verified by reading it. After touching `SKILL.md`, a template, or a
script, run the gates — they are the only evidence that the change is consistent:

1. `node $SKILL_DIR/scripts/selftest.js` must print `PASS: … 项全部通过` (exit 0). It checks the
   18 required files, each template's promised headings, that every `state/dossiers.tsv` row still
   resolves, the rule-sync gate below, and both math/coverage scripts in both directions
   (converts a bad span; leaves CJK `\text{}` alone; coverage exits 0 on a complete translation and
   1 on one missing a float).
2. `node $SKILL_DIR/scripts/check-skill-sync.js` — `SKILL.md` and `references/preset-prompt.md` are
   two hand-written copies of the same rules (this session's mode adds a third: the installed
   preset's persona). The script counts the numbered items of Four laws / Output rendering /
   Section translation / Completion (expect 4/6/6/6) and requires eight judgment phrases in both.
   Editing one side and not the other is a hard failure, not a style question.
3. `node $SKILL_DIR/scripts/update-preset.js` — after editing `references/preset-prompt.md`,
   regenerate the installed `litreading` preset: it rebuilds the `- insert:` entry from the shipped
   `presets/standard.patch.yml` (from the asar cache or by parsing `app.asar` directly), replaces
   the old block in `profiles/desktop/cordis.patch.yml` in place, backs the patch up, and validates
   the whole file with the Loader's `!!js` dialect. Confirm with `Config.listConfigs` that
   `include:preset-litreading` is still there. `--dry-run` prints without writing.

Also run `node $SKILL_DIR/scripts/normalize-math.js <file.md> --write` after writing any dossier
document, and `scripts/check-translation-coverage.js` for every `translate` section.

## Packaging as an Agent Preset

This skill is also meant to become a selectable mode (先 Skill，跑顺后再包成 Preset). Keep
the material it would carry in one place:

- carry verbatim into the preset prompt: the four laws, "Output rendering" above, the mode
  table, Step 0–5, the Completion checklist. The finished text is `references/preset-prompt.md`;
  paste it into the `persona` row of the preset rather than paraphrasing it;
- carry by reference: `references/`, `templates/`, `scripts/` (a preset cannot reach the skill
  directory itself, so either the skill stays installed alongside or the references are restated);
- never let the preset restate the rendering rules in its own words — point it at
  `references/dsh-chat-rendering.md`.

How the picker actually works on this profile (checked against the shipped asar, 2026-11):

- `@deepseek-ai/dsh-client-ui-agent-preset` is in the web bundle's `dsh.client` roster
  (`ui-agent-preset` row, unconditional), and the seat `conversation.hero.agentPreset` exists.
  `Config` reporting `status: "absent"` for that row only means *it owns no config to project* —
  it is not a statement that the picker is missing. Do not re-derive "absent ⇒ not installed".
- The roster content comes from `@deepseek-ai/dsh-agent-preset-registry` (`config.default`) plus
  one `@deepseek-ai/dsh-agent-preset` row per mode, `config: {id, name, description, order, plugins}`.
  The built-in four are shipped as `presets/*.patch.yml` inside `@deepseek-ai/dsh-web-app`.
- To add this mode: append one `- insert:` entry to `profiles/desktop/cordis.patch.yml` whose
  `config.plugins` copies `presets/standard.patch.yml` and swaps the `persona` prefix for
  `references/preset-prompt.md`. A preset replaces the whole sub-plugin list, so it must list its
  own tools. The Loader watches that patch file: after appending, `Config.listConfigs` starts
  reporting `include:preset-<id>` within seconds and no restart is needed. Mode selection only
  affects sessions created afterwards.

