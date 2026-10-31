/** 智能体动作调度的小工具：场景演示脚本与运行时共用。 */
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
