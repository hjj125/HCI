# 化学具身智能蓝本：闭环搭建器 + 可见的手

## 定位（报告叙事）

把灵犀在分子场景的演示从"播脚本"升级为真正的具身智能循环，两个特征一一对应具身智能的核心命题：

- **闭环搭建器 = 因果闭环 + 扰动鲁棒**：感知（看画布现状）→ 规划（与目标求差）→ **预测**（用确定性判题内核当世界模型，行动前算出"这一步之后键数/判题会怎样"）→ 行动 → **核对**（实际 vs 预测，不符就解释并重规划）。学生插手不再取消演示，而是"暂停 → 重感知 → 自适应继续"。预测-行动-观察正是该实验教学生的方法论——智能体身体力行。
- **可见的手 = 身体可见性**：画布内虚拟手，动作前手先到位、捏合、执行；附带"推氢回弹"实验（灵犀把氢拖离理想位、松手、弹回 109.5°——用身体演示"几何是环境中的约束"）。

## 一、闭环搭建器

**新增 `src/scenes/molecule/buildPlanner.ts`（纯函数，可单测）**：
- `goalFromSpec(spec)`：MOLECULE_DEMOS 规格即目标状态（元素多重集 + 键集合），数据不变、执行模型升级。
- `planBuild(goal, atoms, bonds): BuildAction[]`：从当前画布与目标的差求动作序列——多余原子（新加的优先）删除 → 缺失原子按目标序添加 → 缺失键按"元素对+键级"多重集匹配、按容量与连接性确定性地配到具体原子对。每一步都从感知重算（规划器只规划一步也成立）。
- `predictState(atoms, bonds, action)`：在副本上模拟动作，用 `validateMolecule`/`molecularFormula`/价键计数算出预测态（世界模型 = 判题内核本身）。

**MoleculeScene 重构 `runMoleculeDemo` 为 `runBuildLoop`**（脚本名不变，brain 提议无需改动）：
```
清空（作为第一个被感知的动作）→ 循环（上限 200 步兜底）：
  感知（molRef 最新原子/键）→ planBuild 取第一个动作 → predictState 得预测态
  → 手动画（见二）→ 执行 → 节奏等待 → 复核实际 vs 预测
  → 不符 → "和你动手的时候撞上了——灵犀重新看一眼" → 循环继续（重规划吸收扰动）
→ 目标达成 → 总结 + 苏格拉底收尾（"现在氧是 2/2——为什么是 H₂O 而不是 H₂O₂？"）
```
- 感知用每渲染刷新的 `molRef`；动作执行沿用 setAtoms/setBonds 函数式更新。
- 用户清空画布（扰动后画布为空）→ 优雅收场："好，画布空了——想看就说'搭一个水分子'"。

**扰动语义升级（框架层小改）**：
- `SceneAgentAdapter` 增加可选 `disturb(): void`；`controller.onBusEvent` 在 acting 期间：适配器有 `disturb` → 只调 disturb（软打断，循环自行暂停-重感知-继续）；没有 → 维持现行为（硬取消）。场景切换/智能体关闭仍走硬取消。
- 分子适配器实现 `disturb`（记录 lastDisturbAt，循环在安静 1.2s 后继续并重新感知）；函数/陶艺适配器不实现 → 保持"学生操作即打断"。
- `repair-overvalence` 保留现有逻辑，增补世界模型台词：动手前"拆掉 #7 之后，碳会回到 4/4"，动手后核对实际键数与预测一致；收尾加苏格拉底反问（"为什么拆氢而不是拆碳？"）。

## 二、可见的手

**MoleculeView**：
- 复用徽标的 DOM 覆盖层方案：新增 `.mol-hand` 覆盖层（内联 SVG 手），状态 hidden/moving/pinching；每帧把手的位置向目标缓动（atom 投影 or 画布空闲位），投影复用 camera.project。
- `MoleculeHandle` 新增方法：`handToAtom(id)`（每帧跟随原子投影）、`handToFree()`、`handPinch(bool)`、`handShow(bool)`、`nudgeAtom(id)`（推原子：短时间内把位置拉向偏移点，之后理想几何缓动自动把它拉回——"弹回"免费获得）。
- 徽标、选中高亮机制不变；手 zIndex 在徽标之上。

**MoleculeScene 动作编排**：所有智能体动作统一"手先到、再捏合、再执行"——加原子（手到出生点）、成键（手到 A → 捏合 → 移到 B → 执行）、拆氢修复（手到氢 → 捏合 → 拆）、highlight（手到出事原子指点，不捏合）。
**推氢回弹 `demo-springback`**：选一个末端氢 → 手到位捏合 → `nudgeAtom` 拖离 → 松开 → "看——它弹回 109.5° 的理想位：几何不是灵犀规定的，是环境里的约束。"仅 VSEPR 模式可用（自由摆放时提示切换）；语音"推一下"直通；brain 新增规则：free 模式 + 画布有分子 + geoMode==='vsepr' + 空闲 60s → 提议（冷却 180s）。快照新增 `geoMode` 供规则与 LLM 上下文使用。

## 改动清单

1. 新增 `src/scenes/molecule/buildPlanner.ts` + `buildPlanner.test.ts`（goalFromSpec/planBuild/predictState：空画布规划、已有杂乱分子先删后搭、目标已达成返回空、预测与内核一致、丁烷大目标可规划）。
2. `src/core/agent/types.ts`：`SceneAgentAdapter` + `disturb?`。
3. `src/core/agent/controller.ts`：acting 期间用户事件 → `disturb?.() ?? 硬取消`；`controller.test.ts` 增加软打断用例（带 disturb 的适配器被打断后演示不取消、run/end 正常发出）。
4. `src/core/services.tsx`：`useSceneAgent` 包装器透传 disturb。
5. `MoleculeView.tsx`：手覆盖层 + 5 个新 handle 方法 + nudge；样式 `.mol-hand` 追加到 `styles.v2.css`。
6. `MoleculeScene.tsx`：runBuildLoop（含预测/复核/苏格拉底收尾）、disturb 实现、手编排、springback 脚本、语音"推一下"、快照加 `geoMode`；`MoleculeView` Props 不变。
7. `brain.ts`：springback 提议规则（读 snapshot.geoMode）；`brain.test.ts` 增加 1-2 项。
8. README（灵犀章节 + 化学章节 + 测试数）与交接文档（3.8 增"世界模型与扰动鲁棒"、5.4/5.10、验证记录）更新。

## 明确不做（本期）

- 经验校准学习层、学生手部悬停感知（上轮问题里的另外两项，未选）。
- LLM 产生动作（维持"规则规划 + LLM 语言"的既定架构）。
- 修复/搭建目标之外的自由探索规划（如响应"搭个好吃的"这类无规格目标）。

## 验证

`npm test`（预计 317+ 项）+ `npm run build`；演示验收路径：任务 B 里乱搭一气 → 提议"改好它" → 修复带预测台词与反问；语音"搭一个水分子" → 手到位逐步搭建，中途手动删一个氢 → 灵犀暂停后自适应补上；语音"推一下" → 推氢回弹。