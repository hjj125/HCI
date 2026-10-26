import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { subjects } from '../registry';

/** 平台首页 · 封面导航：品牌 hero + 学科卡片导航 + 平台概况（默认落地页）。 */
export function HomeScene({ active }: SceneProps) {
  const experimentCount = subjects.filter(g => g.id !== 'home').reduce((s, g) => s + g.experiments.length, 0);
  const go = (id: string) => bus.emit({ scene: 'home', source: 'mouse', intent: 'switch', phase: 'end', value: id });
  return <section className="panel home-landing" hidden={!active}>
    <div className="home-glow g1" /><div className="home-glow g2" /><div className="home-glow g3" />
    <div className="home-eyebrow">EMBODIEDEDU · 灵境智学 · 具身学习多模态交互平台</div>
    <h1 className="home-title">让知识，可以被操作</h1>
    <p className="home-sub">手势、语音、鼠标与键盘产生相同的语义事件——八大学科、{experimentCount} 个动手实验，全部离线运行，判题确定性可复现。</p>
    <div className="home-actions">
      <button className="primary" style={{ width: 'auto' }} onClick={() => go('slides')}>开始上课 →</button>
      <span className="help">进入需要手势的实验前，先在左下角“启用摄像头手势”；背诵镜需开启“语音命令”。</span>
    </div>
    <div className="home-stats">
      <span><b>{subjects.length}</b> 学科组</span>
      <span><b>{experimentCount}</b> 个动手实验</span>
      <span><b>220+</b> 项自动化测试</span>
      <span><b>4</b> 类输入模态</span>
      <span><b>0</b> 上传 · 画面与音频不出本机</span>
    </div>
    <div className="home-cards">
      {subjects.filter(g => g.id !== 'home').map(g => (
        <div className="home-card" key={g.id}>
          <h4>{g.title}<small>{g.experiments.length} 个实验</small></h4>
          {g.experiments.map(s => (
            <button key={s.id} aria-label={`进入${s.title}（${g.title}）`} title={s.description} onClick={() => go(s.id)}>
              <span className="scene-icon">{s.icon}</span><span>{s.title}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
    <p className="help" style={{ marginTop: 16 }}>学习过程仅记录交互元数据（不含画面）；摄像头画面本地推理，不录制、不上传；语音识别由浏览器完成，不保存音频。</p>
  </section>;
}
