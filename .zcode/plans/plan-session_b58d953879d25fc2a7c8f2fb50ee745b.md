# 美术板块 · 手势开花（art-bloom）实现计划

## 效果定义
深蓝紫暮色夜空中悬浮一朵发光粒子花：**握拳=花苞收拢，五指张开=花瓣绽放**，张开程度连续控制绽放度，移动手掌花朵跟随；手离开后花留在原地轻轻呼吸。UI 切换 4 种花型（樱花/波斯菊/雏菊/数学玫瑰），支持鼠标备用与作品照导出。纯演示模式（已确认不做任务判题）。

## 调研结论（GitHub 方案组合）
- **形态 morph 范式**（[hand_fireworks](https://github.com/holynova/hand_fireworks)、[Gesture-Controlled-Particles](https://github.com/longzheng268/Gesture-Controlled-Particles)）：每个粒子持有「花苞位置」与「绽放位置」两组坐标，全局进度 uBloom 0→1 插值，配每粒子错峰 delay + back-out 缓动产生"次第绽开"感。我们散开目标从文字点阵换成花型点阵。
- **花型数学**：花瓣轮廓用玫瑰曲线 r=cos(kθ) 变体（沿瓣长 u 参数化、瓣宽 sin(πu)^c 填充、加 z 向卷曲），花芯用叶序螺旋（r∝√i，黄金角 137.5°）。
- **渲染**：THREE.Points + 自定义 ShaderMaterial（~60 行 GLSL：vertex 做 mix(aBud, aBloom, eased)+呼吸偏移，fragment 用 canvas 生成的柔光圆点贴图 + AdditiveBlending 发光感）。16000 粒子（花瓣 12000 + 花芯 4000）+ 1500 星空点，集显无压力。项目无 ShaderMaterial 先例，此处是必要新增；无其他新依赖。

## 文件变更

### 1. 新建 `src/scenes/art/bloom.ts` — 纯函数内核（可单测，仿 pottery.ts）
- `SPECIES`：4 种花型参数（花瓣数 5/8/13、玫瑰曲线 k=5，瓣长/卷曲/色带各异）
- `budPositions(n)`：花苞泪滴形点阵
- `bloomPositions(species, n)`：花瓣+花芯点阵（玫瑰曲线+叶序）
- `delays(n)`：按花瓣索引+瓣内弧长错峰
- `colors(species, n)`：花瓣色带（粉→白尖）+金色花芯
- `spreadToBloom(landmarks)`：五指 tip-to-wrist 距离（掌宽归一化）→ 连续绽放度 0..1（含死区与平滑曲线）
- `backOut(t)` 缓动、`updateBloom(current, target, dt)` 平滑趋近

### 2. 新建 `src/scenes/art/BloomView.tsx` — Three.js 视图（仿 PotteryView 生命周期）
- 暮色背景：竖直渐变 canvas 贴图（深蓝紫 #0b1026→#2a1a52 系）+ 微闪星空 Points
- 粒子系统：ShaderMaterial morph、花随手位置平滑 lerp、相机微视差、`!active` 时降频节流（照抄 PotteryView 的 active 处理）
- `forwardRef` 暴露：`setGesture({x, y, spread, present})`、`setSpecies(i)`、`reset()`、`snapshot()`
- 卸载时 dispose 全部 geometry/material/texture/renderer

### 3. 新建 `src/scenes/art/BloomScene.tsx` — UI 壳（仿 PotteryScene 精简版）
- `useScenePolicy('art-bloom')`：从 `sample.landmarks` 算 spread、把 `{x,y,spread,present}` 推给 View（EMA 平滑）
- 鼠标备用：指针移动=花位置，按住左键=绽放
- 工具栏：4 花种按钮、绽放度读数、重置、导出作品照（snapshot 走 `useSceneSnapshot`，含 species/bloom/spread/duration）
- 侧栏：① 手势状态与绽放度读数 ② 花型数学说明（玫瑰曲线、叶序黄金角——本实验的美术×数学教学点）

### 4. 新建 `src/scenes/art/bloom.test.ts` — 内核单测
点数正确、花瓣半径大于花苞、delay 按瓣分组单调、色带断言、spread 映射边界（拳=0、全张=1）。

### 5. 注册接入（4 处小改）
- `src/core/interaction.ts:1`：SceneId 追加 `'art-bloom'`；:31 语音短语表加 `['开花', …]`
- `src/scenes/registry.ts`：art 组追加 `{ id: 'art-bloom', title: '手势开花', icon: '✿', … }`（侧栏/首页卡片自动出现）
- `src/scenes/slides/SlidesScene.tsx:98`：「十四个动手实验」→「十五个」

## 验证
`tsc -b` + `vitest run`；启动 dev server 用浏览器自测：鼠标路径驱动绽放/收拢、4 花型切换、暮色视觉与粒子发光效果截图检查。