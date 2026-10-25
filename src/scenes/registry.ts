import type { SubjectGroup, ExperimentDefinition } from './types';
import { SlidesScene } from './slides/SlidesScene';
import { WhiteboardScene } from './whiteboard/WhiteboardScene';
import { GeometryScene } from './geometry/GeometryScene';
import { FunctionsScene } from './functions/FunctionsScene';
import { AngleScene } from './bodyangle/AngleScene';
import { PhysicsScene } from './physics/PhysicsScene';
import { MoleculeScene } from './molecule/MoleculeScene';
import { ReciteScene } from './recite/ReciteScene';
import { BioMotionScene } from './biomotion/BioMotionScene';
import { GeographyScene } from './geography/GeographyScene';
import { DayNightScene } from './geography/DayNightScene';
import { SeasonsScene } from './geography/SeasonsScene';
import { MoonPhaseScene } from './geography/MoonPhaseScene';

/**
 * 学科注册表：每个学科下辖若干实验，平台壳按学科分组渲染导航。
 * 新增学科实验时，在对应学科下登记一行（对应总体设计方案“学科插件层”）。
 */
export const subjects: SubjectGroup[] = [
  {
    id: 'tools', title: '课堂工具',
    experiments: [
      { id: 'slides', title: '课件', icon: '▤', description: '课堂放映、挥手翻页与激光笔', component: SlidesScene },
      { id: 'whiteboard', title: '白板', icon: '✎', description: '隔空书写、画笔/橡皮与撤销', component: WhiteboardScene },
    ],
  },
  {
    id: 'math', title: '数学',
    experiments: [
      { id: 'geometry', title: '空间几何', icon: '◇', description: '正方体截面探究（演示 + 任务 A/B/C）', component: GeometryScene },
      { id: 'functions', title: '函数绘图', icon: '∿', description: '用身体画函数：手势采样→拟合识别类型与表达式（演示 + 任务 A/B/C）', component: FunctionsScene },
      { id: 'math-bodyangle', title: '身体量角器', icon: '∠', description: '用双手拼出角度：关键点夹角实时测量与内角和探究（演示 + 任务 A/B/C）', component: AngleScene },
    ],
  },
  {
    id: 'physics', title: '物理',
    experiments: [
      { id: 'physics', title: '力与运动', icon: '⬡', description: '力矢量拖动与牛顿仿真（演示 + 任务 A/B/C）', component: PhysicsScene },
    ],
  },
  {
    id: 'chemistry', title: '化学',
    experiments: [
      { id: 'chem-molecule', title: '分子搭建', icon: '⚛', description: '点选原子成键，搭出分子模型与同分异构体（演示 + 任务 A/B/C）', component: MoleculeScene },
    ],
  },
  {
    id: 'chinese', title: '语文',
    experiments: [
      { id: 'chinese-recite', title: '背诵镜', icon: '文', description: '对麦克风背诵古诗词，逐字对齐标注易错字（演示 + 任务 A/B/C）', component: ReciteScene },
    ],
  },
  {
    id: 'biology', title: '生物',
    experiments: [
      { id: 'bio-motion', title: '运动系统', icon: '⦾', description: '骨架叠加摄像头，探究关节与骨骼肌协作（演示 + 任务 A/B/C）', component: BioMotionScene },
    ],
  },
  {
    id: 'geography', title: '地理 · 数字地球',
    experiments: [
      { id: 'geography', title: '找国家', icon: '◉', description: '手势旋转地球、选中区域与 AI 讲解（支持语音定位）', component: GeographyScene },
      { id: 'geo-daynight', title: '晨昏线', icon: '◐', description: '昼夜半球与城市灯光，时区与晨昏线探究（演示 + 任务 A/B）', component: DayNightScene },
      { id: 'geo-seasons', title: '五带与四季', icon: '☀', description: '五带划分、昼夜长短与太阳视运动影长探究（演示 + 任务 A/B/C）', component: SeasonsScene },
      { id: 'geo-moonphase', title: '月相仪', icon: '☾', description: '月相成因与周期：拖动月球公转，看朔望圆缺（演示 + 任务 A/B/C）', component: MoonPhaseScene },
    ],
  },
];

/** 全部实验的扁平列表（壳的主区渲染与查找用）。 */
export const experiments: ExperimentDefinition[] = subjects.flatMap(g => g.experiments);
export const experimentTitle = (id: string) => experiments.find(e => e.id === id)?.title ?? id;
