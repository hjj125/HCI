# 美术实验一 · 陶艺工坊（art-pottery）——虚拟拉坯与彩绘

## 0. 目标与形态

新增"美术"学科组首个实验：**虚拟陶轮**——学生从圆柱陶坯开始，用双手手势"拉坯"塑形（捏泥式+整体式双层），再切到彩绘模式在旋转的陶坯上直接手绘上釉（支持 2/4/8 重旋转对称纹样与十种传统釉色）。对准美术课程素养：造型能力、对称与重复（纹样设计）、色彩运用。延续平台铁律：确定性内核可单测、手势词汇零新增、任务 A/B/C、离线运行。
实现期间会顺带重启 dev 服务器（后台通知显示其已退出，exit 4）。

## 1. 确定性内核 `src/scenes/art/pottery.ts`（约 0.5 天 + 单测约 10 项）

- **陶坯模型**：`ProfilePoint { y, r }` 控制点列（y∈[0.02,1.2] 升序=高度，r∈[0.05,1]=半径），默认圆柱坯
- **塑形操作（纯函数）**：`stretchProfile(factor)` 拉长/压缩（y 整体缩放钳位）、`scaleRadius(factor)` 胖瘦、`pinchProfile(yTarget, deltaR, σ)` 局部捏塑（高斯衰减，"手在哪捏哪"）、`smoothProfile` 平滑
- **几何与度量**：`lathePoints(profile, segments)`（Catmull-Rom 插值出 LatheGeometry 需要的平滑轮廓点）、`potMetrics` → { height, maxR, maxRy, volume=Σπr²dy, aspect=height/2maxR }、`classifyShape` → 碗（maxRy≤0.45 且 aspect≤0.85）/ 瓶（aspect≥1.4）/ 自由
- **彩绘数学**：`strokeSegments(from, to, spacing)` 笔迹插值盖章点列、`symmetricStamps(n)` 旋转对称副本、`coverageRatio(pixels)` 彩绘覆盖率（像素统计）
- 单测：默认坯合法性（y 升序/r≥0）、三操作数学、lathePoints 单调与数量、metrics 与规则圆柱体积误差、三分类判定、对称盖章、笔迹插值、覆盖率

## 2. 三维视图 `PotteryView.tsx`（约 1 天，套 CubeView 生命周期模式）

- 场景：陶轮转盘（深色圆盘，持续自转）+ 陶坯（LatheGeometry + MeshPhongMaterial，`map` 挂 1024×512 的 CanvasTexture）
- **几何重建节流**：profile 变化后 ≥50ms 才重建一次（24 控制点×64 段，成本可控）；rAF 只做转轮旋转+渲染；清理按 CubeView 完整清单（traverse dispose）；tick 内不引用 world.current（白屏教训）
- 彩绘模式下转轮自动降速到 20%（模拟真实"慢轮上釉"），拉坯模式常速

## 3. 场景 `PotteryScene.tsx`（约 1.5 天）

**拉坯手势（双层）**：
- 单手捏合=捏泥：捏合瞬间的屏幕高度映射陶坯高度（作用位置跟随手上下移动），横向移动=该处收/放半径（pinchProfile）
- 双手捏合=整体：同向上/下移动→拉长/压缩（stretch），张/合→变胖/变瘦（scaleRadius）
- 挥手=转轮速度冲量；双手张合缩放视角
- 鼠标完整备用：侧栏 2D 轮廓编辑器（侧影+可拖控制点）+ 高度/宽度滑杆

**彩绘**：toolbar 切换拉坯/彩绘模式 → 捏合=落笔，移动=笔迹：raycast 命中陶坯 → UV → 按笔刷在 CanvasTexture 盖章（strokeSegments 防断线），对称纹样时同时盖 n 个旋转副本（symmetricStamps）；釉色盘 10 种传统釉色（青花蓝/釉里红/豆青/赭石/天青/黑釉…）+ 笔刷三档 + 对称档位（自由/2/4/8 重）+ "清除彩绘"

**任务**：
- **A · 拉坯规律预测**："双手捏住陶坯向上提，器壁会——变高变薄/变矮变厚/不变"（真陶艺规律：变高变薄），提交后现场操作验证
- **B · 造型挑战**（目标循环）："拉一只高瘦的瓶"（aspect≥1.4）/"拉一只宽碗"（aspect≤0.85 且 maxRy≤0.45）——potMetrics 确定性判题，达成后锁定
- **C · 对称纹样彩绘**：选 ≥2 重对称在陶坯上绘装饰 → 判定 coverageRatio≥6% 且使用 ≥2 种釉色 → 反思"对称与重复在纹样设计中的作用"

侧栏：①任务/当前造型（形状分类+长宽比读数）②轮廓编辑器（鼠标备用）③提示与反思；快照导出 profile+metrics+颜色纹样选择+覆盖率+128×64 彩绘缩略图（dataURL，约几 KB）

## 4. 注册与收尾（约 0.5 天）

- 新学科组：`{ id: 'art', title: '美术', experiments: [{ id: 'art-pottery', title: '陶艺工坊', icon: '∪', description: '手势拉坯塑形与对称纹样彩绘（演示 + 任务 A/B/C）' }] }`
- `SceneId` 增 `'art-pottery'`；`VOICE_RULES` 增 `['陶艺', …]`；场景级语音："拉长/压缩/变胖/变瘦/清除彩绘"与釉色名（"青花""朱红"）
- README（导航表/美术段落/已实现/测试计数）、设计文档 `docs/plans/pottery-design.md`、场景测试（接入/任务门控，内核靠单测）
- **重启 dev 服务器**并验证服务新代码

## 5. 工期与风险

合计约 **3.5–4 天**：内核 0.5 + 视图 1 + 场景 1.5 + 彩绘对称 0.5 + 收尾 0.5。

| 风险 | 对策 |
|---|---|
| LatheGeometry 重建频率 | 50ms 节流 + 仅 profile 真变时重建（CubeView 模式） |
| 快速移动笔迹断线 | strokeSegments 按间距插值盖章 |
| 彩绘时转轮太快画不准 | 彩绘模式自动降速 20% |
| 捏泥式手势精度 | 锚定高度跟随手移动；半径变更钳位+平滑；profile 编辑器做鼠标兜底 |
| 纹理数据导出过大 | 快照仅导 128×64 缩略 dataURL |