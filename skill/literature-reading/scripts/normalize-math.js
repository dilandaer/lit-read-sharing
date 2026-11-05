#!/usr/bin/env node
/**
 * normalize-math.js — make display math render in the DSH chat view.
 *
 * The DSH markdown renderer registers three math constructs
 * (dsh-web-frontend/dist/assets/index-*.js, function JF()):
 *
 *   flow:  $ -> WF = nw($, $, $, false)  name "sameLineDollarMathFlow"
 *   flow:  \ -> VF = nw(\, [, ], true)   name "backslashMathFlow"
 *   text:  \ -> ZF                        name "backslashMathText"   (\(...\))
 *
 * "sameLine" is literal: a $$...$$ pair must OPEN AND CLOSE ON ONE LINE. A display
 * block that spans lines is swallowed whole and the rest of the message degrades to
 * literal source. \[ ... \] is not recognised in the chat body at all (CommonMark
 * eats the backslashes: \[ renders as "["). Inline $...$ is the only form that
 * always renders.
 *
 * So: every display equation becomes ONE physical line.
 *   \[ <math> \]            -> $$ <math> $$
 *   $$                      -> $$ <math> $$
 *   <math>
 *   $$
 *   $$<math>                -> $$ <math> $$
 *   <math>$$
 *
 * Guards (a span is left untouched and reported instead of being mangled):
 *   - the body must not contain a stray single $ (that would be inline math inside
 *     a display block — a sign the span is not really one equation);
 *   - CJK is allowed only inside \text{...} / \mathrm{...} / \mbox{...};
 *   - fenced code blocks are never touched;
 *   - a body longer than MAXLEN is left alone.
 *
 * Usage:
 *   node normalize-math.js <file.md> [--write] [--quiet]
 *   node normalize-math.js <dir> --write        (every *.md directly inside dir)
 *
 * Exit code 0 = nothing left to fix, 1 = spans were converted (or would be, in a dry
 * run), 2 = spans were skipped because a guard fired (inspect them by hand).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MAXLEN = 6000;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;
const stripTextMacros = (s) =>
  s.replace(/\\text\{[^{}]*\}/g, '')
   .replace(/\\mathrm\{[^{}]*\}/g, '')
   .replace(/\\mbox\{[^{}]*\}/g, '')
   .replace(/\\operatorname\{[^{}]*\}/g, '');
const loneDollar = (s) => /(^|[^\\$])\$(?!\$)/.test(s);
const squash = (s) => s.replace(/\s+/g, ' ').trim();

function acceptable(body) {
  if (!body) return false;
  if (body.length > MAXLEN) return false;
  if (loneDollar(body)) return false;
  if (CJK.test(stripTextMacros(body))) return false;
  return true;
}

function normalizeFile(file, write) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const out = [];
  const skipped = [];
  let i = 0, inCode = false, converted = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) { inCode = !inCode; out.push(line); i++; continue; }
    if (inCode) { out.push(line); i++; continue; }
    const t = line.trim();

    // (1) a line that is exactly $$
    if (t === '$$') {
      let buf = [], j = i + 1, closed = false;
      while (j < lines.length) {
        if (lines[j].trim() === '$$') { closed = true; break; }
        buf.push(lines[j]); j++;
      }
      if (closed) {
        const body = squash(buf.join(' '));
        if (acceptable(body)) { out.push('$$ ' + body + ' $$'); converted++; i = j + 1; continue; }
        skipped.push({ line: i + 1, why: 'guard', text: body.slice(0, 80) });
        for (let k = i; k <= j; k++) out.push(lines[k]);
        i = j + 1; continue;
      }
    }

    // (2) \[ ... \]  (same line or spanning)
    if (t.startsWith('\\[')) {
      const rest = t.slice(2);
      if (rest.includes('\\]')) {
        const body = squash(rest.split('\\]')[0]);
        if (acceptable(body)) { out.push('$$ ' + body + ' $$'); converted++; i++; continue; }
      } else {
        let buf = [rest], j = i + 1, closed = false;
        while (j < lines.length) {
          if (lines[j].includes('\\]')) { buf.push(lines[j].split('\\]')[0]); closed = true; break; }
          buf.push(lines[j]); j++;
        }
        if (closed) {
          const body = squash(buf.join(' '));
          if (acceptable(body)) { out.push('$$ ' + body + ' $$'); converted++; i = j + 1; continue; }
          skipped.push({ line: i + 1, why: 'guard', text: body.slice(0, 80) });
          for (let k = i; k <= j; k++) out.push(lines[k]);
          i = j + 1; continue;
        }
      }
    }

    // (2b) INLINE \[ ... \] or \( ... \) inside a sentence -> $ ... $
    //      The chat body never recognises these delimiters (CommonMark eats the
    //      backslash), so a sentence like "其中 \[x\] 表示..." would print literally.
    if (!t.startsWith('\\[') && (line.includes('\\[') || line.includes('\\('))) {
      if (line.includes('`')) {
        skipped.push({ line: i + 1, why: 'inline-backtick', text: line.slice(0, 80) });
        out.push(line); i++; continue;
      }
      let changed = 0;
      const nl = line
        .replace(/\\\[([^\]\n]*?)\\\]/g, (m, inner) => {
          const b = squash(inner);
          if (!acceptable(b)) return m;
          changed++; return '$ ' + b + ' $';
        })
        .replace(/\\\(([^)\n]*?)\\\)/g, (m, inner) => {
          const b = squash(inner);
          if (!acceptable(b)) return m;
          changed++; return '$ ' + b + ' $';
        });
      if (changed) { converted += changed; out.push(nl); i++; continue; }
    }

    // (3) $$content ... content$$ spanning lines
    if (t.startsWith('$$') && t !== '$$') {
      const rest = line.replace(/^\s*\$\$/, '');
      if (!rest.trimEnd().endsWith('$$') && !rest.includes('$$')) {
        let buf = [rest], j = i + 1, closed = false;
        while (j < lines.length) {
          const s = lines[j];
          if (s.includes('$$')) {
            if (s.trimEnd().endsWith('$$')) { buf.push(s.replace(/\$\$\s*$/, '')); closed = true; }
            break;
          }
          buf.push(s); j++;
        }
        if (closed) {
          const body = squash(buf.join(' '));
          if (acceptable(body)) { out.push('$$ ' + body + ' $$'); converted++; i = j + 1; continue; }
          skipped.push({ line: i + 1, why: 'guard', text: body.slice(0, 80) });
          for (let k = i; k <= j; k++) out.push(lines[k]);
          i = j + 1; continue;
        }
      }
    }

    out.push(line); i++;
  }

  const res = out.join('\n');
  const count = (s) => (s.match(/\$\$/g) || []).length;
  const head = path.basename(file);
  console.log(`${head}: converted=${converted} skipped=${skipped.length} ` +
              `$$=${count(src)}->${count(res)} lines=${lines.length}->${res.split('\n').length}`);
  skipped.forEach((s) => console.log(`   ! line ${s.line} skipped: ${s.text}`));
  if (write && converted) fs.writeFileSync(file, res, 'utf8');
  return { converted, skipped: skipped.length };
}

// ---- main ----
const args = process.argv.slice(2);
const write = args.includes('--write');
const quiet = args.includes('--quiet');
const targets = args.filter((a) => !a.startsWith('--'));
if (!targets.length) {
  console.error('usage: node normalize-math.js <file.md|dir> [--write] [--quiet]');
  process.exit(2);
}

let files = [];
for (const t of targets) {
  const st = fs.statSync(t);
  if (st.isDirectory()) {
    files.push(...fs.readdirSync(t).filter((f) => f.endsWith('.md')).map((f) => path.join(t, f)));
  } else files.push(t);
}

let conv = 0, skip = 0;
for (const f of files) {
  const r = normalizeFile(f, write);
  conv += r.converted; skip += r.skipped;
}
if (!quiet) console.log(`\ntotal: converted=${conv} skipped=${skip} written=${write && conv > 0}`);
process.exit(skip > 0 ? 2 : conv > 0 ? (write ? 0 : 1) : 0);
