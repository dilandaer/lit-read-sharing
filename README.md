# literature-reading — 和 AI 一起精读理论化学文献

一个 DeepSeek Harness（DSH）用的 **skill + agent 模式**：它不替你总结论文，而是陪你把它拆开——
固定科学问题、重建理论线、逐条复现编号公式、维护符号/近似/口径账本，然后批判。

> A co-reading skill and agent preset for theoretical chemistry / physics papers. It does not
> summarize: it rebuilds the argument, re-derives every numbered equation, keeps a symbol and
> approximation ledger, and attacks the paper for hidden assumptions. Every claim carries a page
> anchor.

---

## 它产出什么

每篇论文一个 dossier（放在 **论文 PDF 旁边**，`<论文所在目录>/<firstauthor><year>_<topic>/`）：

| 文件 | 内容 |
|---|---|
| `SOURCE.md` / `meta/source.json` | 来源、sha256、页数、工具版本、可复现命令 |
| `text/pNNN.txt` / `pages/pNNN.png` | 每页文本与渲染图（公式只能从 png 读） |
| `CARD.md` | 骨架卡：科学问题 / 假设 / 方法路线 / 关键数值 / 作者自认的局限 |
| `SYMBOLS.md` | 符号表、近似清单、单位与口径核对 |
| `DERIVATION.md` | 编号公式逐条复现（identity / proposition / approximation 分类） |
| `CRITIQUE.md` | 隐藏假设、缺口、可推广方向、可放心引用与不可引用清单 |
| `TRANSLATION_*.md` | 可选：正文与 SI 的分节全文译文（有覆盖率闸门） |
| `QUESTIONS.md` / `INDEX.md` | 跨论文台账（提问清单、阅读状态） |

工作方式的三条硬规则：**无锚点不论断**（`text/pNNN.txt:NNN`）、**公式只从像素读**、**读是对话**
（每个检查点最多三个问题，停下等回答）。

## 两种用法

1. **只要 skill**：在任意 DSH 会话里说“用 literature-reading 精读这篇：`<pdf>`”。
2. **要模式**：安装后新建会话时在模式选择器里选 **文献共读 — Literature co-reader**，
   该会话默认就是这位同行读者。

## 安装

前置：Windows + DSH 桌面版；`node` 在 PATH；poppler（`pdftotext` / `pdftoppm` / `pdfinfo`）
在 PATH —— MiKTeX 自带，或装 poppler-windows。

```powershell
git clone <this-repo> lit-read-sharing
cd lit-read-sharing
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

脚本做四件事，每件都可单独关掉：

| 步骤 | 落到哪 | 关掉 |
|---|---|---|
| 复制 skill | `%DSH_HOME%\skills\literature-reading\` | — |
| 追加数学渲染规则 | `%DSH_HOME%\AGENTS.md`（带标记，重复运行不会重复追加） | `-SkipAgents` |
| 生成模式条目 | `%DSH_HOME%\profiles\<profile>\cordis.patch.yml`（先备份，就地替换不重复） | `-SkipPreset` |
| 自检 | `node scripts/selftest.js` | — |

安装后自检应打印 `PASS: 15 项全部通过`。模式只对**之后新建**的会话生效；没出现在选择器里就重启 DSH。

卸载：

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.dsh\skills\literature-reading"
# 模式条目：删掉 cordis.patch.yml 里 # Literature-reading agent preset 到 # end: literature-reading preset 之间那块
```

## 目录

```
skill/literature-reading/
  SKILL.md                          # 步骤闸门、四铁律、四种模式、完成标准
  references/pdf-pipeline.md        # poppler 命令、dpi/裁剪算术、PDF 陷阱
  references/theoretical-chemistry-checklist.md
  references/dsh-chat-rendering.md  # 为什么行内 $...$ 行、跨行 $$ 不行
  references/preset-prompt.md       # 模式 persona 的唯一真源
  templates/{CARD,SYMBOLS,DERIVATION,CRITIQUE,INDEX,QUESTIONS}.md
  scripts/litread.ps1               # 建 dossier：抽取文本 + 渲染页面 + sha256
  scripts/litread-page.ps1          # 单页/局部放大渲染（分数坐标裁剪）
  scripts/normalize-math.js         # 把不能渲染的公式定界符改成能渲染的
  scripts/check-translation-coverage.js  # 译文覆盖率闸门（公式/表/图/章节一个都不许漏）
  scripts/check-skill-sync.js       # SKILL.md 与 persona 规则一致性
  scripts/selftest.js               # 15 项自检
  scripts/update-preset.js          # 改完 persona 一条命令重装模式
install/install.ps1
install/AGENTS.md.snippet
```

## 已知限制（说实话的部分）

- **Windows 优先**：`litread*.ps1` 是 PowerShell 5.1；macOS/Linux 需要移植成 node 或 bash。
- 模式生成依赖 `@deepseek-ai/dsh-web-app` 自带的 `presets/standard.patch.yml`（从 `app.asar` 读），
  所以它跟着 DSH 版本走；DSH 大改版后重跑 `node scripts/update-preset.js` 即可。
- 需要 `yaml` 模块（DSH 在 `profiles/<profile>/node_modules` 里带）。
- 没有内置任何论文内容；`state/dossiers.tsv` 初始为空。

---

## 更新发布

改完文件后（本地 git 提交即可，历史不必与远端一致）：



如果  报  / 超时（github.com 的 git 端点被网络拦，而 api.github.com 可用），这个脚本走 REST API 建 commit 并移动分支；加  可把远端压成一个根提交。首次为空仓库时脚本会自动 seed。

## License

MIT. 见 `LICENSE`。
