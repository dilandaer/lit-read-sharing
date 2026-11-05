#!/usr/bin/env node
/**
 * check-translation-coverage.js — 翻译覆盖度校验
 *
 * 用途：防止"译文漏内容"。把原文（SI/Main text 的 poppler 文本层）里出现的
 * 公式编号、表/图编号、章节标题扫出来，逐一核对译文里是否出现对应的
 * `\tag{n}` / `表 Sn` / `图 Sn` / 标题，报出缺口并以非零码退出。
 *
 * 用法：
 *   node check-translation-coverage.js --source <text-dir> --from p015:19 --to p021:70 --translation <file.md>
 *   node check-translation-coverage.js --source <text-dir> --from p015 --to p021 --translation <file.md>   (整页)
 *
 * 退出码：0 全覆盖；1 有缺口；2 参数/IO 错误。
 */
'use strict';
const fs = require('fs');
const path = require('path');

function die(msg) { console.error('ERROR: ' + msg); process.exit(2); }

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) out[a.slice(2)] = argv[++i];
    else die('无法解析的参数 ' + a);
  }
  return out;
}

const args = parseArgs(process.argv);
for (const k of ['source', 'from', 'to', 'translation']) if (!args[k]) die('缺少 --' + k);

const dir = args.source;
if (!fs.existsSync(dir)) die('源目录不存在: ' + dir);
if (!fs.existsSync(args.translation)) die('译文不存在: ' + args.translation);

// 解析 pNNN:L 形式
function splitSpec(spec) {
  const m = /^p(\d{3})(?::(\d+))?$/.exec(spec);
  if (!m) die('页码格式应为 pNNN 或 pNNN:行号，收到 ' + spec);
  return { page: m[1], line: m[2] ? parseInt(m[2], 10) : null };
}
const from = splitSpec(args.from);
const to = splitSpec(args.to);

// 收集源文本
const files = fs.readdirSync(dir).filter(f => /^p\d{3}\.txt$/.test(f)).sort();
const wanted = files.filter(f => {
  const n = parseInt(f.slice(1, 4), 10);
  return n >= parseInt(from.page, 10) && n <= parseInt(to.page, 10);
});
if (!wanted.length) die('范围内没有 text/pNNN.txt');

let sourceLines = [];
for (const f of wanted) {
  const p = parseInt(f.slice(1, 4), 10);
  let lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
  if (p === parseInt(from.page, 10) && from.line) lines = lines.slice(from.line - 1);
  if (p === parseInt(to.page, 10) && to.line) lines = lines.slice(0, to.line);
  sourceLines = sourceLines.concat(lines.map(l => ({ page: p, text: l })));
}

// 1) 公式编号：行尾 (NN) 或 (NNx)
const eqs = new Set();
for (const { text } of sourceLines) {
  const t = text.trim();
  // 公式编号出现在行尾；排除 "SA(10)" 这类被断行切开的名称与 "Eq.(10)" 这类引用
  if (!/SA\(\d+\)/.test(t)) {
    const m = /(?<![A-Za-z.])\((\d{1,2}[a-z]?)\)\s*$/.exec(t);
    if (m) eqs.add(m[1]);
  }
}

// 2) 表/图编号
const floats = new Set();
for (const { text } of sourceLines) {
  // SI: TABLE S12 / FIG. S21
  for (const m of text.matchAll(/TABLE\s+S(\d+)/gi)) floats.add('TABLE S' + m[1]);
  for (const m of text.matchAll(/FIG\.\s+S(\d+)/gi)) floats.add('FIG. S' + m[1]);
  // 正文: TABLE I / FIG. 3
  for (const m of text.matchAll(/TABLE\s+(I{1,3}V?|IV|V|VI)\b/g)) floats.add('TABLE ' + m[1]);
  for (const m of text.matchAll(/FIG\.\s+(\d+)\b/g)) floats.add('FIG. ' + m[1]);
}

// 3) 章节标题（罗马数字 + 大写标题）
const heads = new Set();
for (const { text } of sourceLines) {
  const t = text.trim();
  const m = /^(I{1,3}|IV|V|VI)\.\s+([A-Z][A-Z0-9 ,\-–/()']{6,})$/.exec(t);
  if (m) heads.add(m[1] + '. ' + m[2].trim());
}

const tr = fs.readFileSync(args.translation, 'utf8');
const missingEq = [...eqs].filter(n => {
  const tag = new RegExp('\\\\tag\\{' + n + '\\}').test(tr);
  // 也接受 $$ ... \qquad(n) $$ 这种旧写法
  const paren = new RegExp('\\((' + n + ')\\)\\s*\\$\\$', 'm').test(tr);
  return !tag && !paren;
});
const bodyNoTag = tr.includes('\\tag{');
const missingFloat = [...floats].filter(raw => {
  const zh = raw.replace(/^TABLE\s+/, '表 ').replace(/^FIG\.\s+/, '图 ');
  return !tr.includes(raw) && !tr.includes(zh);
});
const missingHead = [...heads].filter(h => !tr.includes(h));

function report(name, total, missing) {
  const ok = missing.length === 0;
  console.log((ok ? 'OK  ' : 'MISS') + '  ' + name + ': ' + (total - missing.length) + '/' + total);
  if (!ok) for (const m of missing) console.log('       缺失 -> ' + m);
  return ok;
}

const okEq = report('公式编号', eqs.size, missingEq);
const okFloat = report('表/图编号', floats.size, missingFloat);
const okHead = report('章节标题', heads.size, missingHead);

console.log('---');
console.log('源范围: p' + from.page + (from.line ? ':' + from.line : '') + ' – p' + to.page + (to.line ? ':' + to.line : ''));
console.log('译文: ' + args.translation + ' (' + Buffer.byteLength(tr, 'utf8') + ' B)');
if (!bodyNoTag && eqs.size > 5) console.log('提示: 译文里一个 \\tag{} 都没有，可能是用 (n) 而非 \\tag{n} 标注公式编号');

process.exit(okEq && okFloat && okHead ? 0 : 1);
