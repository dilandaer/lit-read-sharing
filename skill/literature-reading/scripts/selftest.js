#!/usr/bin/env node
/**
 * selftest.js — literature-reading skill 自检
 *
 * 一条命令把"这个 skill 还是完整的"变成可执行断言。改完 SKILL.md / scripts / templates
 * 之后跑一次；review 别人改的 skill 也跑这个。
 *
 * 检查项：
 *   1. 必需文件都在（SKILL.md、4 个 reference、6 个 template、4 个 script、dossier 注册表）
 *   2. 每个 template 保留它承诺的章节标题（脚本与 SKILL.md 引用的锚点）
 *   3. state/dossiers.tsv 每行路径仍然存在（搬过目录就报 stale）
 *   4. scripts/check-skill-sync.js 通过（SKILL.md 与 preset persona 规则一致）
 *   5. scripts/normalize-math.js 正向 × 反向（坏定界符被改写、CJK 保护不误伤）
 *   6. scripts/check-translation-coverage.js 正反两例（全覆盖 exit 0、缺表 exit 1）
 *   7. 若 profile 里已装 preset：persona 长度与关键段落齐全（软检查，不影响退出码）
 *
 * 用法：node selftest.js [-v]
 * 退出码：0 全通过；1 有失败。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERBOSE = process.argv.includes('-v');
const NODE = process.execPath;
let failures = 0;
let checks = 0;

function ok(name, extra) {
  checks++;
  console.log('OK    ' + name + (extra ? '  ' + extra : ''));
}
function fail(name, detail) {
  checks++;
  failures++;
  console.log('FAIL  ' + name + (detail ? '\n        ' + String(detail).trim().split(/\r?\n/).join('\n        ') : ''));
}
function check(name, cond, detail) {
  if (cond) ok(name); else fail(name, detail);
}
function run(args) {
  const r = spawnSync(NODE, args, { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'litread-selftest-'));
}

// ---- 1. 必需文件 ----
const REQUIRED = [
  'SKILL.md',
  'references/pdf-pipeline.md',
  'references/theoretical-chemistry-checklist.md',
  'references/claim-discipline.md',
  'references/derivation-package.md',
  'references/dsh-chat-rendering.md',
  'references/preset-prompt.md',
  'templates/CARD.md',
  'templates/SYMBOLS.md',
  'templates/DERIVATION.md',
  'templates/CRITIQUE.md',
  'templates/INDEX.md',
  'templates/QUESTIONS.md',
  'scripts/litread.ps1',
  'scripts/litread-page.ps1',
  'scripts/normalize-math.js',
  'scripts/check-translation-coverage.js',
  'scripts/check-skill-sync.js',
  'scripts/update-preset.js',
  'scripts/selftest.js',
];
const missingFiles = REQUIRED.filter((f) => !fs.existsSync(path.join(ROOT, f)));
check('必需文件 ' + REQUIRED.length + ' 个', missingFiles.length === 0, missingFiles.join(', '));
// ---- 2. template 章节 ----
const TEMPLATE_HEADINGS = {
  'templates/CARD.md': ['## 0 一句话', '## 1 它想解决的科学问题', '## 3 核心 claim', '## 5 关键结论与数量级', '## 7 我还不确定'],
  'templates/SYMBOLS.md': ['## 1 符号表', '## 2 近似清单', '## 3 口径核对', '## 4 一致性自检'],
  'templates/DERIVATION.md': ['## 0 公式地图', '## 1 逐条复现', '## 2 缺口清单'],
  'templates/CRITIQUE.md': ['## 1 隐藏假设', '## 2 论证类型审计', '## 3 没有展示的东西', '## 4 适用范围', '## 5 可推广方向'],
  'templates/INDEX.md': ['# 文献台账 · INDEX'],
  'templates/QUESTIONS.md': ['# 问题台账 · QUESTIONS'],
};
for (const [file, heads] of Object.entries(TEMPLATE_HEADINGS)) {
  const p = path.join(ROOT, file);
  if (!fs.existsSync(p)) continue; // 已在第 1 项报过
  const text = fs.readFileSync(p, 'utf8');
  const absent = heads.filter((h) => !text.includes(h));
  check(file + ' 章节', absent.length === 0, '缺少: ' + absent.join(' | '));
}

// ---- 3. dossier 注册表 ----
const REG = path.join(ROOT, 'state', 'dossiers.tsv');
if (!fs.existsSync(REG)) {
  check('state/dossiers.tsv', false, '文件不存在（SETUP 第一次运行后才会生成）');
} else {
  const rows = fs
    .readFileSync(REG, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'));
  const stale = [];
  for (const line of rows) {
    const [key, p] = line.split('\t');
    if (!p || !fs.existsSync(p)) stale.push(key + ' -> ' + (p || '(空)'));
  }
  check('dossier 注册表 ' + rows.length + ' 行', stale.length === 0, stale.join('\n'));
}

// ---- 3b. 抽象性：真实 dossier 的 key 不得出现在说明文本里 ----
{
  const texts = [
    'SKILL.md',
    ...fs.readdirSync(path.join(ROOT, 'references')).filter((f) => f.endsWith('.md')).map((f) => 'references/' + f),
    ...fs.readdirSync(path.join(ROOT, 'templates')).filter((f) => f.endsWith('.md')).map((f) => 'templates/' + f),
  ];
  const keys = fs.existsSync(REG)
    ? fs
        .readFileSync(REG, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim() && !l.startsWith('#'))
        .map((l) => l.split('\t')[0])
        .filter(Boolean)
    : [];
  const leaks = [];
  for (const rel of texts) {
    const body = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const k of keys) if (body.includes(k)) leaks.push(rel + ' 含真实 key `' + k + '`');
  }
  check('说明文本不绑定具体文献（' + keys.length + ' 个 key 扫描 ' + texts.length + ' 个文件）', leaks.length === 0, leaks.join('\n'));
}

// ---- 4. 规则同步 ----
{
  const r = run([path.join(ROOT, 'scripts', 'check-skill-sync.js')]);
  check('SKILL.md ↔ preset-prompt.md 规则同步', r.code === 0, r.out);
  if (VERBOSE && r.code === 0) console.log(r.out.trim());
}

// ---- 5. normalize-math 正反两向 ----
{
  const dir = tmpdir();
  const bad = path.join(dir, 'bad.md');
  fs.writeFileSync(
    bad,
    ['行内 \\[ a + b \\] 结束。', '独立公式：', '$$', 'E = mc^2', '$$', '尾部文字。', ''].join('\n'),
    'utf8',
  );
  const r = run([path.join(ROOT, 'scripts', 'normalize-math.js'), bad, '--write']);
  const after = fs.readFileSync(bad, 'utf8');
  const convertedOk = /converted=([1-9]\d*)/.exec(r.out) !== null;
  const noLoneDelim = !/^\s*\$\$\s*$/m.test(after) && !/^\s*\\[[\]]/m.test(after);
  const inlineOk = /\$ a \+ b \$/.test(after);
  check(
    'normalize-math 改写坏定界符',
    r.code === 0 && convertedOk && noLoneDelim && inlineOk,
    r.out + '\n--- 结果 ---\n' + after,
  );

  const cjk = path.join(dir, 'cjk.md');
  fs.writeFileSync(cjk, '$$ \\text{被丢掉的相干项} = 0 $$\n', 'utf8');
  const r2 = run([path.join(ROOT, 'scripts', 'normalize-math.js'), cjk, '--write']);
  const after2 = fs.readFileSync(cjk, 'utf8');
  check(
    'normalize-math 不误伤 CJK \\text{}',
    r2.code === 0 && after2.includes('\\text{被丢掉的相干项}'),
    r2.out,
  );
}

// ---- 6. coverage 正反两例 ----
{
  const dir = tmpdir();
  const src = path.join(dir, 'text');
  fs.mkdirSync(src);
  fs.writeFileSync(
    path.join(src, 'p001.txt'),
    ['Some prose.', 'A relation follows here (1)', 'TABLE S1', 'FIG. S2', 'III. RESULTS AND DISCUSSION', ''].join('\n'),
    'utf8',
  );
  const good = path.join(dir, 'good.md');
  fs.writeFileSync(
    good,
    ['# 译文', '$$ a = b \\tag{1} $$', '**表 S1** 数值', '**图 S2** 图题', '## III. RESULTS AND DISCUSSION', ''].join('\n'),
    'utf8',
  );
  const args = (tr) => [path.join(ROOT, 'scripts', 'check-translation-coverage.js'), '--source', src, '--from', 'p001', '--to', 'p001', '--translation', tr];

  const rGood = run(args(good));
  check('coverage 全覆盖 → exit 0', rGood.code === 0, rGood.out);

  const bad = path.join(dir, 'bad.md');
  fs.writeFileSync(bad, ['# 译文', '$$ a = b \\tag{1} $$', '## III. RESULTS AND DISCUSSION', ''].join('\n'), 'utf8');
  const rBad = run(args(bad));
  check(
    'coverage 缺表图 → exit 1',
    rBad.code === 1 && /表\/图编号/.test(rBad.out) && /MISS/.test(rBad.out),
    rBad.out,
  );
}

// ---- 7. 已装 preset（软检查） ----
{
  const dsh = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const prof = process.env.DSH_PROFILE || 'desktop';
  const patch = path.join(dsh, 'profiles', prof, 'cordis.patch.yml');
  if (!fs.existsSync(patch)) {
    console.log('--    跳过 preset 检查（没有 profile patch）');
  } else {
    const text = fs.readFileSync(patch, 'utf8');
    if (!text.includes('preset-litreading')) {
      console.log('--    跳过 preset 检查（本 profile 未安装 preset-litreading）');
    } else {
      const hasPrefix = /prefix:\s*\|/.test(text);
      const hasLaws = text.includes('## Four laws');
      const hasCompletion = text.includes('## Completion');
      check('preset persona 完整（| 块标量 + Four laws + Completion）', hasPrefix && hasLaws && hasCompletion);
    }
  }
}

console.log('---');
if (failures) {
  console.log('FAILED: ' + failures + '/' + checks + ' 项');
  process.exit(1);
}
console.log('PASS: ' + checks + ' 项全部通过');
