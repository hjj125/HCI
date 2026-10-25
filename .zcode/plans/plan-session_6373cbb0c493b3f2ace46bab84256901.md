# 新实验：地理·五带与四季（geo-seasons）· 修订版（含任务C）

## 目标
在地理学科组下新增第三个实验「五带与四季」（id: `geo-seasons`），探究太阳直射点周年运动与五带划分、昼夜长短、太阳视运动与影长的关系。复用现有 GlobeView 与 solarMath 天文内核，沿用地理组既有模式：演示 + 任务 A/B/C、确定性判题、2 级提示、60 秒停滞提醒、反思提交、会话快照导出、同一套手势词汇。

## 已确认的扩展点（已读码核实）
- `SceneId`：src/core/interaction.ts:1（联合类型加一项）
- 语音全局短语：interaction.ts:30 `VOICE_RULES`（加一行）
- 注册表：src/scenes/registry.ts:34-39 地理组（加一行）
- solarMath.ts 现有：subsolarPoint / sunVector / isDaylight / localTime
- GlobeView.tsx 现有 graticule/borders/marker/highlight 的 group + useEffect 模式可直接仿写
- DayNightScene.tsx 是场景组件模板（任务状态机/手势 policy/指针回退/快照）

## 实施步骤

### Step 1 — solarMath 扩展 + 单测（约 1 天）
在 `src/scenes/geography/solarMath.ts` 新增确定性纯函数：
- `zoneOf(lat)`：'北寒带' | '北温带' | '热带' | '南温带' | '南寒带'（边界 ±23.44° 回归线、±66.56° 极圈）
- `daylightHours(lat, decl)`：昼长小时数，cos H₀ = −tanφ·tanδ，clamp 后处理极昼(24h)/极夜(0h)
- `daylightState(hours)`：'极昼' | '昼长夜短' | '昼夜平分' | '昼短夜长' | '极夜'
- `solarAltitude(lat, decl, utcHours, lon)`：太阳高度角（sin h = sinφ·sinδ + cosφ·cosδ·cosH，H 为时角）
- `shadowRatio(lat, decl, utcHours, lon)`：影长/标杆高 = 1/tan(h)，h≤0 返回 null（夜/太阳未升）——影长最短即正午（当地太阳时≈12）
- `sunriseSunset(lat, decl)`：日出日落时角 H₀（供绘制当日太阳轨迹弧线，极昼/极夜返回全天/无）

单测：二分二至在赤道/回归线/极圈/极点的昼长；五带边界值；正午太阳高度 = 90° − |φ−δ|（北回归线夏至正午 h=90° → 影长 0，"立竿无影"）；h≤0 全天无影（极夜）；与 isDaylight 一致性抽查。

### Step 2 — GlobeView 五带渲染扩展（约 1 天）
props 新增（**默认关闭，不影响找国家/晨昏线两实验**）：
- `zones?: boolean`——五带可视化：半透明纬度带着色 overlay 球壳（radius ≈1.006，ShaderMaterial 按 vUv.y 分带着色）+ 四条分界纬线（回归线/极圈，亮色区别于普通经纬网）
- `subsolarMarker?: { lat, lon } | null`——太阳直射点标记（仿现有 marker 模式）
- `highlightZone?: string | null`——语音点名某一带时加亮该带 overlay

### Step 3 — SeasonsScene 新组件（约 1.5–2 天）
新建 `src/scenes/geography/SeasonsScene.tsx`（以 DayNightScene 为模板）：
- 控件：日期滑杆 doy 1–365、节气按钮 ×4（复用 DATES）、播放键（doy 缓慢推进演示一年）、直射纬度实时显示、五带/经纬网开关
- 演示模式：点选国家/海洋 → 显示纬度、所属五带、当日昼长、极昼极夜状态
- **任务 A · 五带与昼夜预测**：题库（城市 + 节气），学生预测「五带」+「昼夜状态」，`zoneOf` + `daylightHours` 确定性判题，提交后地球调至该日期并 flyTo 城市验证
- **任务 B · 追寻极昼**：目标点（摩尔曼斯克 68.97°N、朗伊尔城 78.2°N、中山站 69.4°S）调整日期使目标极昼/极夜，判定达成 + 反思提交
- **任务 C · 太阳视运动与影长（影子实验室）**：
  - 剖面影子视图（2D canvas，与白板/物理渲染一致）：地平线 + 当日太阳轨迹弧线（随 doy 与纬度变化）+ 当前太阳位置点 + 标杆与影长实时变化
  - 一天时间滑杆（UTC，驱动太阳在弧线上移动；与晨昏线 UTC 滑杆心智一致）
  - **全局—局部联动**：在地球点选城市 → 影子视图切到该纬度；是答辩可讲的"多视图联动建立空间认知"设计点
  - 轻判题：把太阳调到当日影长最短时刻（当地正午，太阳时≈12:00，确定性判定）；达成后观察不同节气弧线高低与影长对比，反思提交
  - 彩蛋教学点：北回归线夏至正午"立竿无影"（影长=0）、极昼时太阳整日不落
- 手势：与晨昏线完全同套 policy（捏合选中/拖动旋转/挥手惯性/双手缩放），零新增手势词汇
- 语音：场景级 `registerVoicePolicy`——"春分/夏至/秋分/冬至"跳节气、"热带/北温带/…"高亮对应带、"正午"直跳正午时刻；播报后沿用 `pauseRecognition` 防自激
- 快照：`useSceneSnapshot('geo-seasons', …)` 记录任务/日期/预测/判题/反思 + 任务C 的纬度/时刻/是否达成最短影长；intent 全部复用现有 predict/hint/submit/run/pause/reset，无需新增

### Step 4 — 注册与全局接入（约 0.5 小时）
- interaction.ts SceneId 加 `'geo-seasons'`
- VOICE_RULES 加 `['四季', { intent: 'switch', value: 'geo-seasons' }]`
- registry.ts 地理组登记：`{ id: 'geo-seasons', title: '五带与四季', icon: '☀', description: '五带划分、昼夜长短与太阳视运动影长探究（演示 + 任务 A/B/C）', component: SeasonsScene }`

### Step 5 — 测试、文档与 README 收尾（约 0.5–1 天）
- solarMath 新函数用例 + 场景交互测试（任务 A 判题、任务 B 达成、任务 C 正午判定、语音策略、快照字段）
- 全量 `npm test` 通过（106 项 → 约 125 项）
- README：实验列表加入新实验；顺手修正两处失同步（AI 接口"1.5s/200 次"→ 实际 800ms/300 次；"功能边界"中"第二学科场景尚未实现"的过期表述）
- 新建 `docs/plans/seasons-scene-design.md` 简短设计文档（与 geography-scene-design.md 同风格，注明"太阳视运动"术语以区别于教材"太阳活动"，供课程报告引用）

## 工期与后续
合计约 4–5 天，≥4 周预算内从容。完成后可再议的后续方向（不在本计划内实施）：找国家·双人对战（热座计分）、数学·人体函数绘图仪、物理·光学光路、日晷盘/影子方位角俯视图（可从任务C 升级为独立实验四）；若最终需要用户实验报告，可再加内嵌 SUS/NASA-TLX 问卷（约半天）。