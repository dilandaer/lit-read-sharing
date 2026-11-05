# DSH chat rendering — why formulas break and how to write them

Every dossier produced by this skill is heavy on equations, and the chat answer that
accompanies it is where the user actually reads them. The DSH chat view is **not** a
general markdown viewer: it registers a small, deliberately restricted set of math
constructs. Write outside that set and the message degrades to literal source — not one
formula, but everything from that point to the end of the message.

This file records the measurements so nobody has to reverse-engineer `app.asar` twice.

## 1. What the renderer actually supports

Read out of the shipped bundle (V8 bytecode-free, plain ESM):

- bundle: `%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\app.asar`
  → `dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`
- the message body is parsed by `qF(e) = fromMarkdown(e, {extensions:[a7(), tw(), JF(), yb()],
  mdastExtensions:[l7(), $b()]})`; `JF()` returns

  ```
  flow: { "\\": VF, "$": WF }      text: { "\\": ZF }
  WF = nw("$", "$", "$", false)    name: "sameLineDollarMathFlow"
  VF = nw("\\", "[", "]", true)    name: "backslashMathFlow"
  ZF                               name: "backslashMathText"      (\( ... \))
  ```

- rendering: `case "math"` → KaTeX `displayMode: true`; `case "inlineMath"` → `displayMode: false`;
  on failure KaTeX is retried with `{strict:"ignore", throwOnError:false}`, and if it fails
  again the node becomes `<span class="katex-error" style="color:#cc0000">`.

The name is the specification: **sameLine** Dollar Math. `$$ … $$` must open and close on
one physical line.

## 2. Verified behaviour

| form | in chat | in the dossier .md (any markdown editor) |
|---|---|---|
| `$x$` inline, single line | renders | renders |
| `$$ x $$` on one line | **unverified** — the safe bet, try it first | renders |
| `$$` alone on a line, body, `$$` | broken — rest of the message becomes source | renders |
| `\[ … \]` (one or many lines) | broken — `\[` is eaten by CommonMark and shows as `[`, `\,` becomes `,`, `\{` becomes `{` | renders |
| `\( … \)` | not exercised; treat as unavailable | renders |
| display math inside a table cell | breaks the table (pipes) | breaks the table |

Two failures must be told apart before fixing anything:

- **red small text** in place of one formula → KaTeX rejected the LaTeX (unsupported
  command, unbalanced braces). Fix the command (`\tag` and `\label` are display-only in
  LaTeX; prefer `\qquad (7)`), not the delimiters.
- **the rest of the message shows raw `##`, `**`, `$$`** → a delimiter/parse failure. The
  culprit is almost always a multi-line `$$` block or an unclosed one.

## 3. Rules for anything written into the chat

1. Inline `$ … $` by default. Most "display" equations in a chat answer are fine inline.
2. A display equation is **one line**: `$$ <math> $$`. No newline anywhere between the
   fences — matrices go on one line too (`\begin{pmatrix} … \end{pmatrix}` all on one row).
3. Never `$$` alone on its own line, never `\[ … \]`, never `\( … \)`.
4. No display math inside a table cell; put `$ … $` inline there.
5. A long derivation does not belong in chat. Put it in the dossier file, and keep at most
   three one-line display equations in the message: the definition, the step that matters,
   the result.
6. If a formula must be **copied verbatim**, use a ```` ```latex ```` fence and say so —
   a code fence renders as code and is never eaten by the parser.

## 4. Rules for the dossier .md files

The same renderer may show these files (the user opens them in DSH), so the same
discipline applies. Convert and verify with the bundled script:

```
node "%DSH_HOME%\skills\literature-reading\scripts\normalize-math.js" <file-or-dir> --write
```

It rewrites `\[ … \]`, standalone `$$` fences and multi-line `$$content … content$$` into
single-line `$$ … $$`, refuses to touch fenced code blocks, and **refuses** a span whose
body contains a stray single `$` or CJK outside `\text{}` (that is a sign the span was never
one equation). Exit code 0 = clean, 1 = dry run would change something, 2 = something was
skipped and needs a human look.

Run it after writing any math-heavy document, and once more before telling the user the
file is done. Re-running is idempotent.

## 5. When the user reports broken formulas

1. Ask for / look at the screenshot: red text or raw source? (section 2 table)
2. Locate the first `$$` that is not closed on its line.
3. Rewrite that one block single-line; do not rewrite the whole message.
4. If the user pasted the message from another tool (a markdown renderer that prefers
   `$$` blocks), explain that the file keeps either form and only the chat is restricted.
5. Do not patch `app.asar`. It is signed content, replaced on every update, and the
   restriction is genuinely intended (`sameLine` is in the constructor name).

## 6. Carrying this into the Agent Preset

When `literature-reading` is packaged as an Agent Preset, the preset system prompt must
carry, verbatim, the four laws from SKILL.md **and** sections 3 and 4 of this file. A preset
that only inherits the dossier workflow will keep producing chat answers that degrade
halfway. The preset also needs the one-line reminder in its output checklist: "公式：行内
`$…$`；独立公式写成单行 `$$ … $$`；`$$`/`\[` 绝不跨行。"

If the preset gains its own `settings`/prompt file, keep this document as the single source
of truth and reference it instead of copying a drifting paraphrase.
