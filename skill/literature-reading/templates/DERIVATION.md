<!--
公式逐条复现。复制到 lit_reading/<key>/DERIVATION.md。
原文一律从 pages/pNNN.png 抄（必要时 litread-page.ps1 裁剪 300 dpi），绝不从 text/*.txt 抄。
只复现「支撑论证」的公式，不是全部编号公式。
步型借 formula-derivation：identity（恒等式）/ proposition（论文自己提的命题）/
approximation（近似，必须写丢了什么）/ interpretation（物理解释）。
-->

# `<key>` — 公式复现

## 0 公式地图

| Eq. | 做什么 | 输入 | 输出去向 | 后面还用吗 |
|---|---|---|---|---|
| (1) | | | | 用于 (7)(12) / 装饰 |

<「后面还用吗」写「装饰」是可以的，那本身就是对文章结构的判断。>

## 1 逐条复现

### Eq. (1) — <一句话作用>

**原文**（从 png 抄，LaTeX）：

```latex
```

`[p004.png, Eq.(1)]` · 印刷页 <p. 4906>

**复现**：

1. <不跳步地写。跳步要标明跳了什么。>
2. …

**步型**：identity / proposition / approximation / interpretation

**检查**：

- 量纲：<两边量纲是否一致>
- 极限：<R→∞ / Δ→0 / 无关联极限 下是否回到已知结果>
- 守恒或厄米性：<矩阵是否厄米；粒子数是否守恒>
- 数值抽查：<代一组文中给的数据，看是否复现>

**状态**：`REPRODUCED` / `REPRODUCED WITH CORRECTION` / `GAP`

---

### Eq. (2) — <…>

…

## 2 缺口清单

| # | Eq. | 缺什么 | 类型 | 影响 |
|---|---|---|---|---|
| G1 | (9) | 从 (8) 到 (9) 的代数步骤 | 代数步骤 | 若成立则核心结论不受影响 |

<类型只有三种：缺定义 / 缺引用 / 缺一步代数。只写「无法复现」等于没写。>

## 3 交给 formula-derivation 的入口

<若用户要把某条推导做成论文级文档：>

- 目标：<…>
- 不变对象：<…>
- 已有假设：见 SYMBOLS.md §2 A1–An
- 已知缺口：见上表

用 `Skill(formula-derivation)`，产物 `DERIVATION_PACKAGE.md`，本文件只保留入口和缺口。
