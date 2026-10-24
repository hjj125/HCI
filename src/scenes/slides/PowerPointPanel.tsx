type Props = {
  status: string; busy: boolean; backgroundCamera: boolean; onBackgroundChange: (enabled: boolean) => void;
  laser: boolean; onToggleLaser: () => void;
  onControl: (action: 'status' | 'next' | 'previous') => void;
};
export function PowerPointPanel({status,busy,onControl,backgroundCamera,onBackgroundChange,laser,onToggleLaser}: Props) {
  return <>
    <label className="help"><input type="checkbox" checked={backgroundCamera} onChange={e=>onBackgroundChange(e.target.checked)}/> 允许 PPT 模式下后台使用摄像头（切换窗口后继续识别；取消或点击关闭摄像头可停止）</label>
    <h1>PowerPoint 放映控制</h1>
    <p role="status">{busy ? '正在与 PowerPoint 通信…' : status}</p>
    <div className="slide-controls">
      <button disabled={busy} onClick={()=>onControl('previous')}>← 上一步 / 上一页</button>
      <button disabled={busy} onClick={()=>onControl('next')}>下一步 / 下一页 →</button>
      <button className={laser?'selected':''} onClick={onToggleLaser}>激光笔</button>
      <button disabled={busy} onClick={()=>onControl('status')}>检测连接</button>
    </div>
    <p className="help">先打开 PowerPoint 并按 F5 开始放映，然后启用摄像头。张开手掌（拇指与食指分开）向左或向右挥动即可翻页，一次挥手只翻一页，不必瞄准按钮；捏合只用于点击按钮，翻页前请先张开手掌。也支持键盘左右方向键。</p>
    <p className="help">激光笔：比“2”保持约 0.6 秒开关（或按 L 键 / 点击上方按钮）。开启后手指方向显示红色光点。注意：光点显示在本工作台窗口内，不会出现在 PowerPoint 放映窗口上；需要在大屏上指示时请使用应用内课件投影本页面。</p>
    <p className="help">勾选后台使用后，整个人退到一旁、浏览器切到后台（例如全屏放映）仍继续识别；翻页仍然是挥手：手掌向右为下一页，向左为上一页，不需要瞄准屏幕区域。</p>
    <p className="help">每次翻页间隔至少 0.9 秒；捏合后的 0.3 秒内不判定挥手，避免“伸手去操作”途中被当成翻页。上一/下一步遵循 PowerPoint 原生播放顺序，可能先播放页内动画，并不总是直接切换整页。</p>
    <p className="help">单屏使用：在 PowerPoint 的“设置幻灯片放映”中选择“观众自行浏览（窗口）”，将放映与浏览器并排。全屏放映建议使用双屏并保持浏览器可见；未勾选后台摄像头时，浏览器隐藏会停止摄像头。勾选后识别循环由 Worker 定时器驱动，切到后台仍保持约每秒 10 次采样。</p>
    <p className="help">仅在 Windows 的本地开发服务（npm run dev）下提供桌面控制。不会上传、修改或保存你的 PPT 文件。</p>
  </>;
}
