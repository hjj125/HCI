import type { SceneDefinition } from './types';
import { SlidesScene } from './slides/SlidesScene';
import { WhiteboardScene } from './whiteboard/WhiteboardScene';
import { GeometryScene } from './geometry/GeometryScene';
import { PhysicsScene } from './physics/PhysicsScene';
import { GeographyScene } from './geography/GeographyScene';

/**
 * 场景注册表：平台壳按此渲染导航与内容。
 * 新增学科实验时，在这里登记一行即可（对应总体设计方案“学科插件层”）。
 */
export const scenes: SceneDefinition[] = [
  { id: 'slides', title: '课件', icon: '▤', description: '课堂放映、挥手翻页与激光笔', component: SlidesScene },
  { id: 'whiteboard', title: '白板', icon: '✎', description: '隔空书写、画笔/橡皮与撤销', component: WhiteboardScene },
  { id: 'geometry', title: '空间几何', icon: '◇', description: '正方体截面探究（演示 + 任务 A/B/C）', component: GeometryScene },
  { id: 'physics', title: '力与运动', icon: '⬡', description: '力矢量拖动与牛顿仿真（演示 + 任务 A/B/C）', component: PhysicsScene },
  { id: 'geography', title: '数字地球', icon: '◉', description: '手势旋转地球、选中区域与 AI 讲解（世界地理）', component: GeographyScene },
];
