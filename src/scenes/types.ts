import type { ComponentType } from 'react';
import type { SceneId } from '../core/interaction';

/**
 * 学科实验插件定义：两级结构——学科（SubjectGroup）下辖多个实验（Experiment）。
 * 新增实验 = 新建 scenes/<subject>/<experiment>/ 目录实现组件，并在 registry.ts 对应学科下登记一行。
 */
export type SceneProps = { active: boolean };
export type ExperimentDefinition = {
  id: SceneId;
  title: string;
  icon: string;
  description: string;
  component: ComponentType<SceneProps>;
};
export type SubjectGroup = {
  id: string;
  title: string;
  experiments: ExperimentDefinition[];
};
/** 兼容旧名。 */
export type SceneDefinition = ExperimentDefinition;
