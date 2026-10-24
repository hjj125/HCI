import type { ComponentType } from 'react';
import type { SceneId } from '../core/interaction';

/**
 * 学科场景插件定义。新增一个学科实验 = 新建 scenes/<name>/ 目录实现组件，
 * 并在 registry.ts 中登记一行；平台壳自动获得导航项、输入路由与记录导出。
 */
export type SceneProps = { active: boolean };
export type SceneDefinition = {
  id: SceneId;
  title: string;
  icon: string;
  description: string;
  component: ComponentType<SceneProps>;
};
