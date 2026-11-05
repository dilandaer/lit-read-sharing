#!/usr/bin/env node
/**
 * update-preset.js — 从 references/preset-prompt.md 重新生成并安装 `litreading` preset
 *
 * 为什么需要：preset 的 persona 是 `cordis.patch.yml` 里的一段长块标量，手写副本必然与
 * `references/preset-prompt.md` 漂移（改了一边忘了另一边）。这个脚本让"改 prompt → 重装
 * preset"成为一条命令，并在装完后自检。
 *
 * 用法：
 *   node update-preset.js            # 生成 + 安装 + 校验
 *   node update-preset.js --dry-run  # 只打印，不改文件
 *
 * 它做什么：
 *   1. 取 persona 正文（`preset-prompt.md` 里从 "You are a co-reader" 起到文末）；
 *   2. 取内置 standard preset 的插件清单（优先用 %TEMP%/asarout 的缓存，没有就按 asar 头
 *      解析 app.asar 现场抽出来）；
 *   3. 生成 `- insert:` 条目（id `preset-litreading`、config.id `litreading`、order 5）；
 *   4. 在 `profiles/desktop/cordis.patch.yml` 里**替换**旧条目（按生成文件的注释头定位，
 *      删到下一个顶层列表项为止），其余条目原样保留，写前备份；
 *   5. 用 Loader 方言（`!!js` 自定义 tag）解析整个 patch，断言条目还在、id 唯一、
 *      persona 长度与关键小节齐全。退出码 0/1。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const H = process.env.USERPROFILE || os.homedir();
const DSH = process.env.DSH_HOME || path.join(H, '.dsh');
const PROFILE = process.env.DSH_PROFILE || 'desktop';
const SKILL = path.join(__dirname, '..');
const PROMPT = path.join(SKILL, 'references', 'preset-prompt.md');
const PATCH = path.join(DSH, 'profiles', PROFILE, 'cordis.patch.yml');
const ASAR = process.env.DSH_ASAR || path.join(
  process.env.LOCALAPPDATA || path.join(H, 'AppData', 'Local'),
  'Programs', 'DeepSeek Harness', 'resources', 'app.asar'
);
const CACHE = path.join(os.tmpdir(), 'asarout', 'dsh__node_modules__@deepseek-ai__dsh-web-app__presets__standard.patch.yml');
const MARK = '# Literature-reading agent preset. Generated from';
const END_MARK = '# end: literature-reading preset';
const DRY = process.argv.includes('--dry-run');

function requireYaml() {
  try { return require('yaml'); } catch (e) {}
  try { return require(path.join(DSH, 'profiles', PROFILE, 'node_modules', 'yaml')); } catch (e) {}
  console.error('ERROR: yaml module not found - run `npm i yaml` in the profile dir, or set DSH_HOME/patch manually');
  process.exit(1);
}
const YAML = requireYaml();
const jsTag = { tag: 'tag:yaml.org,2002:js', resolve: (s) => String(s) };

const fail = (msg) => { console.error('ERROR: ' + msg); process.exit(1); };

// ---------- 1. persona ----------
if (!fs.existsSync(PROMPT)) fail('缺少 ' + PROMPT);
const promptLines = fs.readFileSync(PROMPT, 'utf8').split(/\r?\n/);
const start = promptLines.findIndex((l) => l.startsWith('You are a co-reader'));
if (start < 0) fail('preset-prompt.md 里找不到 persona 起点（"You are a co-reader"）');
const persona = promptLines.slice(start).join('\n').replace(/\s+$/, '');
if (persona.length < 4000) fail('persona 太短（' + persona.length + ' 字符），检查 preset-prompt.md');
if (/\{\{\s*(model|preset|model_name)\s*\}\}/i.test(persona)) fail('persona 里含模板占位符，preset 不会替换它');

// ---------- 2. standard preset ----------
function fromAsar() {
  const fd = fs.openSync(ASAR, 'r');
  try {
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    const headerSize = head.readUInt32LE(12);
    if (!(headerSize > 0 && headerSize < 64 * 1024 * 1024)) fail('asar 头异常 headerSize=' + headerSize);
    const jsonBuf = Buffer.alloc(headerSize);
    fs.readSync(fd, jsonBuf, 0, headerSize, 16);
    const tree = JSON.parse(jsonBuf.toString('utf8'));
    const base = 16 + headerSize;
    const want = 'dsh-web-app/presets/standard.patch.yml';
    let hit = null;
    (function walk(node, trail) {
      if (hit || !node || !node.files) return;
      for (const [name, child] of Object.entries(node.files)) {
        const p = trail ? trail + '/' + name : name;
        if (p.endsWith(want) && child.offset !== undefined) { hit = child; return; }
        walk(child, p);
      }
    })(tree, '');
    if (!hit) fail('asar 里找不到 ' + want);
    const buf = Buffer.alloc(hit.size);
    fs.readSync(fd, buf, 0, hit.size, base + Number(hit.offset));
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}
const standard = fs.existsSync(CACHE) ? fs.readFileSync(CACHE, 'utf8') : fromAsar();
const stdLines = standard.split(/\r?\n/);

// ---------- 3. entry ----------
const entry = [];
entry.push(MARK);
entry.push('# @deepseek-ai/dsh-web-app/presets/standard.patch.yml with the persona prefix replaced.');
entry.push('# Persona source: ~/.dsh/skills/literature-reading/references/preset-prompt.md');
entry.push('# Regenerate with: node ~/.dsh/skills/literature-reading/scripts/update-preset.js');

const body = persona.split('\n').map((l) => (l.trim() === '' ? '' : '                ' + l));
let gotId = false, gotOrder = false, gotPersona = false;
for (const line of stdLines) {
  if (line.startsWith('    - id: preset-standard')) { entry.push('    - id: preset-litreading'); gotId = true; continue; }
  if (line === '        id: standard') {
    entry.push('        id: litreading');
    entry.push('        name: 文献共读 — Literature co-reader');
    entry.push('        description: 一位审过、也写过这个领域论文的同行：边读边给判断，指出没写出来的假设与对不上的数字——不替你总结。');
    continue;
  }
  if (line === '        order: 1') { entry.push('        order: 5'); gotOrder = true; continue; }
  if (line.includes('prefix: You are a coding agent')) {
    entry.push('              prefix: |');
    body.forEach((l) => entry.push(l));
    gotPersona = true;
    continue;
  }
  entry.push(line);
}
while (entry.length && entry[entry.length - 1].trim() === '') entry.pop();
entry.push(END_MARK);
if (!gotId || !gotOrder || !gotPersona) fail(`standard preset 结构不符（id=${gotId} order=${gotOrder} persona=${gotPersona}）`);

// ---------- 4. splice ----------
if (!fs.existsSync(PATCH)) fail('缺少 ' + PATCH);
const patchLines = fs.readFileSync(PATCH, 'utf8').split(/\r?\n/);
const at = patchLines.findIndex((l) => l.startsWith(MARK));
let kept = patchLines;
let action = 'append';
if (at >= 0) {
  // 本条目从 MARK 开始；紧随其后的第一个顶层 `- ` 行就是它自己的 `- insert:`，
  // 而条目内部所有内容都缩进 ≥2 空格 —— 所以"下一个顶层 `- `"只会在下一条条目的开头出现。
  // 若存在结尾哨兵注释，优先用它（更稳）。
  const sentinel = patchLines.findIndex((l, i) => i > at && l.startsWith(END_MARK));
  let end;
  if (sentinel > at) end = sentinel + 1;
  else {
    const own = patchLines.findIndex((l, i) => i > at && /^- /.test(l));
    if (own < 0) fail('找到 MARK 但找不到它自己的 `- insert:`（patch 被手工改坏？）');
    end = patchLines.findIndex((l, i) => i > own && /^- /.test(l));
    if (end < 0) end = patchLines.length;
  }
  kept = [...patchLines.slice(0, at), ...patchLines.slice(end)];
  action = 'replace';
  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
}
const next = kept.join('\n') + '\n\n' + entry.join('\n') + '\n';

if (DRY) {
  console.log(`[dry-run] ${action}: persona ${persona.length} 字符, entry ${entry.length} 行, patch ${patchLines.length} -> ${next.split('\n').length} 行`);
  process.exit(0);
}

// ---------- 5. validate + write ----------
let doc;
try {
  doc = YAML.parse(next, { customTags: [jsTag] });
} catch (e) {
  fail('生成的 patch 解析失败：' + e.message);
}
const ids = [], rows = [];
(function walk(node) {
  for (const e of node) {
    if (!e || typeof e !== 'object') continue;
    if (e.insert !== undefined) { walk(e.insert); continue; }
    if (e.id) ids.push(e.id);
    if (e.name === '@deepseek-ai/dsh-agent-preset') rows.push(e);
    if (e.plugins) walk(e.plugins);
  }
})(doc);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
const mine = rows.filter((r) => r.id === 'preset-litreading');
const prefixRow = mine[0] && mine[0].config && mine[0].config.plugins.find((p) => p.id === 'persona');
const prefix = prefixRow && prefixRow.config && prefixRow.config.prefix;
if (dup.length) fail('patch 里有重复 id: ' + dup.join(','));
if (mine.length !== 1) fail('期望 1 条 preset-litreading，实际 ' + mine.length);
if (!prefix) fail('persona 行没有生效');
if (prefix.replace(/\s+$/, '') !== persona.replace(/\s+$/, '')) {
  fail('persona 内容不符：patch ' + prefix.length + ' 字符 vs prompt ' + persona.length + ' 字符');
}
for (const h of ['## Four laws', '## Completion', '## Section translation']) {
  if (!prefix.includes(h)) fail('persona 缺少小节 ' + h);
}

const backup = PATCH + '.bak-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
fs.copyFileSync(PATCH, backup);
fs.writeFileSync(PATCH, next, 'utf8');

console.log(`${action}: persona ${persona.length} 字符 / entry ${entry.length} 行`);
console.log(`patch: ${patchLines.length} -> ${next.split('\n').length} 行, 顶层条目 ${doc.length}, preset 行 ${rows.length}, id 唯一`);
console.log('backup: ' + backup);
console.log('STATUS: ok  （Loader 会热加载；模式只影响之后新建的会话）');
