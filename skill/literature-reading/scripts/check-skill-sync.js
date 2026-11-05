#!/usr/bin/env node
/**
 * check-skill-sync.js — SKILL.md 与 preset persona 的规则同步校验
 *
 * 为什么需要：同一个模式有两份规则文本 —— `SKILL.md`（会话里加载）与
 * `references/preset-prompt.md`（装进 preset 的 persona）。两份手写文本必然漂移：
 * 已经发生过一次（Completion 6 条 vs 5 条、Step 2 漏了 checklist 一轮）。
 * 这个脚本把"规则条数"与"必须出现的判据"变成可执行断言，改了一边忘了另一边就非零退出。
 *
 * 用法：node check-skill-sync.js        （退出码 0 = 同步；1 = 漂移；2 = 文件缺失）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILL = path.join(ROOT, 'SKILL.md');
const PROMPT = path.join(ROOT, 'references', 'preset-prompt.md');

for (const f of [SKILL, PROMPT]) {
  if (!fs.existsSync(f)) {
    console.error('ERROR: 缺少 ' + f);
    process.exit(2);
  }
}
const skill = fs.readFileSync(SKILL, 'utf8');
const prompt = fs.readFileSync(PROMPT, 'utf8');

/** 取某个二级标题（含关键词）到下一个同级/更高级标题之间的正文 */
function section(text, needle) {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => /^#{2,3}\s/.test(l) && l.toLowerCase().includes(needle.toLowerCase()));
  if (i < 0) return null;
  const level = lines[i].match(/^#+/)[0].length;
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    const m = lines[j].match(/^(#+)\s/);
    if (m && m[1].length <= level) break;
    out.push(lines[j]);
  }
  return { title: lines[i].trim(), body: out.join('\n') };
}

/** 数段落里的编号条目：优先 `1.` 行，否则数 `(1)` 这样的括号编号 */
function countItems(body) {
  const numbered = body.split(/\r?\n/).filter((l) => /^\d+\.\s/.test(l)).length;
  if (numbered) return numbered;
  const paren = body.match(/\(\d+\)/g);
  return paren ? new Set(paren).size : 0;
}

const RULES = [
  { key: 'four laws', label: 'Four laws', expect: 4 },
  { key: 'output rendering', label: 'Output rendering', expect: 6 },
  { key: 'section translation', label: 'Section translation', expect: 6 },
  { key: 'completion', label: 'Completion', expect: 6 },
];

// 两份文件都必须出现的判据（换成别的话就没法保证行为一致）
const PHRASES = [
  ['锚点', /No anchor, no claim/],
  ['像素读公式', /Equations come from pixels/],
  ['区分 paper/inferred/objection', /\((?:paper|inferred|objection)\)/],
  ['三问停下', /three questions/],
  ['不得遗漏', /不得遗漏/],
  ['normalize-math 自检', /normalize-math\.js/],
  ['覆盖率自检', /check-translation-coverage\.js/],
  ['未核实标记', /未核实/],
];

const problems = [];
const rows = [];

for (const rule of RULES) {
  const a = section(skill, rule.key);
  const b = section(prompt, rule.key);
  if (!a || !b) {
    problems.push(`${rule.label}: 缺少小节（SKILL.md ${a ? 'ok' : '缺'} / preset ${b ? 'ok' : '缺'}）`);
    continue;
  }
  const na = countItems(a.body);
  const nb = countItems(b.body);
  const ok = na === rule.expect && nb === rule.expect;
  rows.push({ label: rule.label, skill: na, prompt: nb, expect: rule.expect, ok });
  if (!ok) problems.push(`${rule.label}: 条数 SKILL=${na} preset=${nb}（期望 ${rule.expect}）`);
}

for (const [label, re] of PHRASES) {
  const a = re.test(skill);
  const b = re.test(prompt);
  rows.push({ label, skill: a ? 'yes' : 'no', prompt: b ? 'yes' : 'no', expect: 'yes', ok: a && b });
  if (!a || !b) problems.push(`${label}: SKILL.md=${a ? 'yes' : 'no'} preset=${b ? 'yes' : 'no'}`);
}

console.log('item'.padEnd(34) + 'SKILL'.padEnd(8) + 'PRESET'.padEnd(8) + 'EXPECT');
for (const r of rows) {
  console.log(r.label.padEnd(34) + String(r.skill).padEnd(8) + String(r.prompt).padEnd(8) + String(r.expect));
}
console.log('---');
if (problems.length) {
  console.log('漂移 ' + problems.length + ' 处：');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('OK: SKILL.md 与 preset-prompt.md 规则一致');
