import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { subjects, experiments } from '../registry';
import { speak, zhVoiceName } from '../../core/services';
import { BrandMark } from '../../ui/brand';
import { IconArrow, IconBook, IconClose, IconCube, IconHand, IconSearch, IconShield } from '../../ui/icons';

type HomeProps = SceneProps & {
  query?: string;
  subject?: string;
  onQuery?: (q: string) => void;
  onSubject?: (s: string) => void;
  onGuide?: () => void;
};

const CATEGORY: Record<string, string> = {
  geometry: '数学 · 空间认知', functions: '数学 · 函数图像', 'math-bodyangle': '数学 · 身体测量',
  physics: '物理 · 探究实验', 'chem-molecule': '化学 · 微观世界', 'chinese-recite': '语文 · 智能辅助',
  'bio-motion': '生物 · 身体结构', 'art-pottery': '美术 · 创造表达', 'art-bloom': '美术 · 创意互动',
  geography: '地理 · 世界探索', 'geo-daynight': '地理 · 晨昏探究', 'geo-seasons': '地理 · 四季规律',
  'geo-moonphase': '地理 · 月相观测',
};
const TAGS: Record<string, [string, string]> = {
  geometry: ['手势旋转', '三维截面'], functions: ['动作采样', '曲线拟合'], 'math-bodyangle': ['姿态测量', '角度探究'],
  physics: ['力矢量', '实时仿真'], 'chem-molecule': ['点选成键', '空间构型'], 'chinese-recite': ['语音对齐', '逐字反馈'],
  'bio-motion': ['姿态骨架', '肌肉协作'], 'art-pottery': ['手势拉坯', '对称彩绘'], 'art-bloom': ['开合绽放', '粒子艺术'],
  geography: ['手势旋转', 'AI 讲解'], 'geo-daynight': ['昼夜模型', '时区探究'], 'geo-seasons': ['直射点', '影长变化'],
  'geo-moonphase': ['公转拖动', '月相周期'], slides: ['挥手翻页', '激光指示'], whiteboard: ['隔空书写', '捏合落笔'],
};
const SUBJECT_CLASS: Record<string, string> = {
  数学: 'art-math', 物理: 'art-physics', 化学: 'art-chem', 生物: 'art-bio', 语文: 'art-chinese', 美术: 'art-art', '地理 · 数字地球': 'art-geo',
};

/** 每个实验的专属矢量插画（本地 SVG，离线可用）。 */
function Art({ id }: { id: string }) {
  const s = { fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'geometry': return <svg viewBox="0 0 340 150"><circle cx="172" cy="74" r="64" stroke="#ab9ce8" strokeWidth="1" fill="none" opacity=".5" strokeDasharray="3 7" /><g stroke="#766cc8" strokeWidth="2" {...s}><path d="m164 30 58 30-56 32-58-30z" fill="#c2b5f3" fillOpacity=".4" /><path d="m108 60 58 32v45l-58-32z" fill="#aaa4ec" fillOpacity=".24" /><path d="m166 92 56-32v45l-56 32z" fill="#8d86e5" fillOpacity=".26" /></g><circle cx="222" cy="60" r="5" fill="#8979dc" /><path d="M232 50h40" stroke="#a294e4" {...s} /></svg>;
    case 'functions': return <svg viewBox="0 0 340 150"><path d="M40 128h268M168 14v120" stroke="#b3acec" strokeWidth="1.5" {...s} /><path d="M64 22q56 184 104 104t110-96" stroke="#8c7fdc" strokeWidth="4" {...s} fill="none" /><circle cx="246" cy="52" r="6" fill="#6e68d2" /><circle cx="110" cy="118" r="4" fill="#b3a8ee" /></svg>;
    case 'math-bodyangle': return <svg viewBox="0 0 340 150"><path d="M96 122h152" stroke="#9d7cc8" strokeWidth="2" {...s} /><path d="M150 120 218 46" stroke="#8f72ce" strokeWidth="5" {...s} /><path d="M150 120 102 68" stroke="#e39ec4" strokeWidth="5" {...s} /><circle cx="150" cy="120" r="7" fill="#9e79ce" /><path d="M192 120a42 42 0 0 0-14-31" stroke="#8f72ce" strokeWidth="2" strokeDasharray="4 4" fill="none" /><text x="196" y="112" fill="#9b75c4" fontSize="12">θ</text></svg>;
    case 'physics': return <svg viewBox="0 0 340 150"><path d="M20 124h300" stroke="#9ecddc" {...s} /><path d="M34 110q60 18 106-22t120-22" stroke="#3db0cf" strokeWidth="3.5" {...s} fill="none" /><circle cx="206" cy="74" r="25" fill="#62bfd9" opacity=".22" /><circle cx="206" cy="74" r="13" fill="#3ca6c6" /><path d="M206 74V26m-8 9 8-10 8 10" stroke="#5770c9" strokeWidth="3" {...s} fill="none" /><path d="M206 74h58m-9-8 9 8-9 8" stroke="#36b9ae" strokeWidth="3" {...s} fill="none" /><text x="219" y="40" fill="#5973aa" fontSize="12">F</text><text x="266" y="70" fill="#38a39e" fontSize="12">v</text></svg>;
    case 'chem-molecule': return <svg viewBox="0 0 340 150"><g stroke="#d88ba9" strokeWidth="10" strokeLinecap="round" opacity=".62"><path d="M168 76 112 42M168 76 226 42M168 76 212 122M168 76 112 122" /></g><circle cx="168" cy="76" r="24" fill="#d877a9" /><circle cx="160" cy="68" r="8" fill="#f7b2cb" opacity=".85" /><circle cx="112" cy="42" r="15" fill="#8b80d7" /><circle cx="226" cy="42" r="17" fill="#a49ce2" /><circle cx="212" cy="122" r="13" fill="#f2a2bd" /><circle cx="112" cy="122" r="12" fill="#b39cdd" /></svg>;
    case 'chinese-recite': return <svg viewBox="0 0 340 150"><rect x="104" y="14" width="132" height="124" rx="10" fill="#fff" fillOpacity=".8" stroke="#e3b98f" strokeWidth="2" /><path d="M124 40h92M124 58h82M124 76h92M124 94h70M124 112h86" stroke="#d9a878" strokeWidth="5" strokeLinecap="round" opacity=".75" /><path d="M124 58h42" stroke="#c96f3a" strokeWidth="6" strokeLinecap="round" /><circle cx="252" cy="34" r="12" fill="#f4c48c" opacity=".8" /></svg>;
    case 'bio-motion': return <svg viewBox="0 0 340 150"><g stroke="#5fa9a0" strokeWidth="9" strokeLinecap="round" opacity=".85"><path d="M170 40v46M170 56l-35 28M170 56l35 28M170 86l-29 40M170 86l29 40" /></g><circle cx="170" cy="23" r="16" fill="#8ecbca" /><g fill="#4f9c94"><circle cx="170" cy="56" r="5" /><circle cx="135" cy="84" r="6" /><circle cx="205" cy="84" r="6" /><circle cx="141" cy="126" r="6" /><circle cx="199" cy="126" r="6" /></g><path d="M222 34h44" stroke="#9fd4cd" strokeWidth="1.6" {...s} /></svg>;
    case 'art-pottery': return <svg viewBox="0 0 340 150"><path d="M144 28h72c-10 19-14 41-9 65 3 17 15 28 7 32h-68c-8-4 4-15 7-32 5-24 1-46-9-65z" fill="#d795c0" stroke="#b06da6" strokeWidth="2" /><ellipse cx="180" cy="28" rx="37" ry="8" fill="#f2c8de" stroke="#b06da6" strokeWidth="2" /><path d="M158 78q22 11 44 0M158 98q22 11 44 0" stroke="#f5daf0" strokeWidth="3" {...s} fill="none" /><ellipse cx="180" cy="132" rx="58" ry="7" fill="#b06da6" opacity=".25" /></svg>;
    case 'art-bloom': return <svg viewBox="0 0 340 150"><g transform="translate(178 72)"><g fill="#d79ae0" opacity=".85"><ellipse rx="12" ry="32" cy="-26" /><ellipse rx="12" ry="32" cy="26" /><ellipse rx="32" ry="12" cx="-26" /><ellipse rx="32" ry="12" cx="26" /><ellipse rx="12" ry="32" cx="-18" cy="-18" transform="rotate(-45)" /><ellipse rx="12" ry="32" cx="18" cy="18" transform="rotate(-45)" /></g><circle r="15" fill="#ffd9a9" /><circle r="6" fill="#f0987c" /></g><g fill="#e6c7f2"><circle cx="258" cy="46" r="2.4" /><circle cx="272" cy="96" r="2" /><circle cx="96" cy="58" r="2.2" /><circle cx="84" cy="110" r="1.8" /></g></svg>;
    case 'geography': return <svg viewBox="0 0 340 150"><circle cx="176" cy="75" r="58" fill="#6fb7cc" /><path d="M138 53 155 33l20 14-9 17-14 4 3 20-17 6-13-20zM192 40l26 8 12 19-15 10-5 23-22 10-8-22 11-19-7-15z" fill="#a6dfcb" opacity=".92" /><ellipse cx="176" cy="75" rx="26" ry="58" fill="none" stroke="#d1f5f7" opacity=".6" /><circle cx="176" cy="75" r="58" fill="none" stroke="#518fb3" strokeWidth="1.6" /><path d="M114 75h124" stroke="#d1f5f7" opacity=".6" /><ellipse cx="259" cy="38" rx="20" ry="7" stroke="#7cc7de" strokeWidth="2" fill="none" transform="rotate(-18 259 38)" /><circle cx="272" cy="32" r="4.5" fill="#7cc7de" /></svg>;
    case 'geo-daynight': return <svg viewBox="0 0 340 150"><circle cx="170" cy="75" r="56" fill="#3b4d7a" /><path d="M170 19a56 56 0 0 1 0 112 78 78 0 0 0 0-112z" fill="#ffd98a" opacity=".92" /><circle cx="170" cy="75" r="56" fill="none" stroke="#8fa6d9" strokeWidth="1.6" /><g fill="#ffe9b3"><circle cx="196" cy="56" r="2" /><circle cx="212" cy="84" r="1.7" /><circle cx="188" cy="102" r="1.6" /></g></svg>;
    case 'geo-seasons': return <svg viewBox="0 0 340 150"><circle cx="170" cy="75" r="22" fill="#ffce6b" /><circle cx="170" cy="75" r="34" fill="#ffce6b" opacity=".3" /><ellipse cx="170" cy="75" rx="108" ry="40" fill="none" stroke="#b7c8ec" strokeWidth="1.6" strokeDasharray="5 6" /><circle cx="62" cy="75" r="11" fill="#7ea4e8" /><circle cx="278" cy="75" r="11" fill="#7ea4e8" /><path d="M170 22v106" stroke="#e8b06c" strokeWidth="1.6" strokeDasharray="4 5" /></svg>;
    case 'geo-moonphase': return <svg viewBox="0 0 340 150"><circle cx="170" cy="75" r="40" fill="#d8e4f5" /><path d="M170 35a40 40 0 0 1 0 80 52 52 0 0 1 0-80z" fill="#8294c9" /><circle cx="170" cy="75" r="40" fill="none" stroke="#9fb2d9" strokeWidth="1.6" /><g fill="#aebde0"><circle cx="90" cy="75" r="7" /><circle cx="250" cy="75" r="7" /></g><ellipse cx="170" cy="75" rx="118" ry="46" fill="none" stroke="#c3cfeb" strokeWidth="1.2" strokeDasharray="4 6" /></svg>;
    case 'slides': return <svg viewBox="0 0 340 150"><rect x="66" y="18" width="208" height="118" rx="10" fill="#fff" stroke="#c9c4ef" strokeWidth="2" /><path d="M82 34h130M82 52h84M82 64h98M82 76h72" stroke="#b3aeea" strokeWidth="5" strokeLinecap="round" opacity=".8" /><path d="M150 108l20-18 17 11 20-27" stroke="#9182e0" strokeWidth="4" {...s} fill="none" /><circle cx="254" cy="34" r="9" fill="#e0475c" opacity=".85" /><path d="m250 29 8 8m0-8-8 8" stroke="#fff" strokeWidth="2" {...s} /></svg>;
    case 'whiteboard': return <svg viewBox="0 0 340 150"><rect x="56" y="16" width="228" height="120" rx="10" fill="#fff" stroke="#bfe0da" strokeWidth="2" /><path d="M82 92q26-64 52-2t50-2 46-26" stroke="#2fae9c" strokeWidth="4" {...s} fill="none" /><circle cx="82" cy="92" r="5" fill="#2fae9c" /><g stroke="#d6eae6" strokeWidth="1.2"><path d="M76 38h176M76 64h176M76 90h176M76 116h176" opacity=".7" /></g><circle cx="236" cy="106" r="6" fill="#8f82dd" /><path d="M96 118q30 10 62 6" stroke="#8f82dd" strokeWidth="3" {...s} fill="none" /></svg>;
    default: return <svg viewBox="0 0 340 150"><circle cx="170" cy="75" r="46" fill="#c9d4f2" opacity=".6" /><path d="M132 96c22-40 54-44 76-2" stroke="#7e8cc9" strokeWidth="4" {...s} fill="none" /></svg>;
  }
}

const SUBJECT_SHORT: Record<string, string> = { '地理 · 数字地球': '地理' };

/** 平台首页 v2：沉浸 Hero + 真实数据带 + 教学工具入口 + 学科实验探索（筛选/搜索/展开）。 */
export function HomeScene({ active, query = '', subject = '全部', onQuery = () => {}, onSubject = () => {}, onGuide = () => {} }: HomeProps) {
  const experimentList = useMemo(() => experiments.filter(s => s.id !== 'home'), []);
  const subjectGroups = useMemo(() => subjects.filter(g => g.id !== 'home' && g.id !== 'tools'), []);
  const [expanded, setExpanded] = useState(false);
  const expRef = useRef<HTMLElement>(null);
  const go = (id: string) => bus.emit({ scene: 'home', source: 'mouse', intent: 'switch', phase: 'end', value: id });

  // 侧栏「学科探索 / 全部实验」→ 定位到本区的实验网格。
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<{ subject?: string }>).detail;
      if (detail?.subject) setExpanded(true);
      setTimeout(() => expRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    };
    window.addEventListener('ee:home-focus', onFocus);
    return () => window.removeEventListener('ee:home-focus', onFocus);
  }, []);

  const matched = experimentList.filter(s => {
    const group = subjects.find(g => g.experiments.some(x => x.id === s.id));
    const inSubject = subject === '全部' || group?.title === subject;
    const q = query.trim().toLowerCase();
    const inQuery = !q || [s.title, s.description, group?.title ?? '', CATEGORY[s.id] ?? '', (TAGS[s.id] ?? []).join(' ')].join(' ').toLowerCase().includes(q);
    return inSubject && inQuery;
  });
  const collapsed = !expanded && subject === '全部' && !query.trim() && matched.length > 6;
  const visible = collapsed ? matched.slice(0, 6) : matched;

  return <section className="panel home-page" hidden={!active}>
    {/* Hero */}
    <section className="hero" aria-label="平台简介">
      <div className="hero-copy">
        <div className="hero-eyebrow">EMBODIED LEARNING · 让学习发生在行动中</div>
        <h1>让知识，<br /><span className="hero-glow">触手可及。</span></h1>
        <p className="hero-sub">从被动观看到主动探索。用手势、动作与实时反馈，让每一个抽象概念，都成为可以亲手理解的世界。</p>
        <div className="hero-actions">
          <button className="primary" onClick={() => expRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>开始探索 →</button>
          <button className="ghost" onClick={onGuide}>▶ 了解交互方式</button>
          <button className="ghost" title={`当前优选音色：${zhVoiceName()}；点击播放自检语句`} onClick={() => {
            speak('语音自检：如果你能听到这句话，说明语音合成正常。');
          }}>🔊 语音自检</button>
        </div>
      </div>
      <div className="hero-visual" aria-hidden="true">
        <svg viewBox="0 0 540 330" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="hv-orb" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#8b8dff" /><stop offset=".55" stopColor="#5adadb" /><stop offset="1" stopColor="#a2f9d0" /></linearGradient>
            <linearGradient id="hv-sideA" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#9b80ff" stopOpacity=".88" /><stop offset="1" stopColor="#433987" stopOpacity=".48" /></linearGradient>
            <linearGradient id="hv-sideB" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#59ced6" stopOpacity=".6" /><stop offset="1" stopColor="#277eaa" stopOpacity=".26" /></linearGradient>
            <radialGradient id="hv-glow"><stop stopColor="#aafff2" stopOpacity=".5" /><stop offset="1" stopColor="#6ea7ff" stopOpacity="0" /></radialGradient>
          </defs>
          <circle cx="300" cy="160" r="150" fill="url(#hv-glow)" />
          <g opacity=".2" stroke="#91bce3" strokeWidth=".8"><path d="M20 285h510M38 258h478M69 231h404" /><path d="m124 330 120-177M235 330l49-177M348 330l-24-177" /></g>
          <g transform="translate(272 156) rotate(-19)"><ellipse className="hv-orbit" rx="200" ry="66" stroke="url(#hv-orb)" strokeWidth="2.2" fill="none" opacity=".7" strokeDasharray="10 8" /></g>
          <g transform="translate(286 142)"><g className="hv-float">
            <polygon points="0,-86 96,-34 0,19 -96,-34" fill="#a0b0ff" fillOpacity=".24" stroke="#b2b6ff" strokeWidth="2" />
            <polygon points="-96,-34 0,19 0,130 -96,77" fill="url(#hv-sideA)" stroke="#958dff" strokeWidth="2" />
            <polygon points="0,19 96,-34 96,77 0,130" fill="url(#hv-sideB)" stroke="#71e5e3" strokeWidth="2" />
            <path d="M-96,-34 0,19 96,-34M0,19v111" stroke="#c1d8ff" strokeOpacity=".6" strokeWidth="1.1" fill="none" />
            <circle cx="0" cy="19" r="4.5" fill="#c3fff4" /></g>
          </g>
          <g opacity=".9" stroke="url(#hv-orb)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" fill="none">
            <path d="M396 299c-8-32-4-48-3-67 0-8-7-11-11-4-8 15-9 32-16 35-9 3-11-13-15-22-3-8-13-7-15 0-3 6-1 18 1 26-7-10-15-14-21-8-5 6 6 25 9 34-8-8-15-6-17 0-3 9 21 35 31 44" />
            <path d="M387 238c3-21 5-40 13-41 10-2 7 25 8 47 11-13 21-15 26-9 5 7-8 21-13 31" />
          </g>
          <circle cx="402" cy="196" r="6.5" fill="#b7fff3" /><circle cx="402" cy="196" r="20" fill="none" stroke="#8cfff0" opacity=".5" /><circle cx="402" cy="196" r="37" fill="none" stroke="#8cfff0" opacity=".18" />
          
          
          
        </svg>
      </div>
      <div className="hero-note">PERCEIVE · INTERACT · DISCOVER</div>
    </section>

    {/* 平台数据概览（真实数据：来自注册表） */}
    <div className="stats-band" role="list" aria-label="平台数据概览">
      <div className="stat-cell" role="listitem"><div className="stat-ico"><IconBook size={18} /></div><div><div className="stat-num">{subjects.length}</div><div className="stat-cap">学科与工具方向</div></div></div>
      <div className="stat-cell" role="listitem"><div className="stat-ico"><IconCube size={18} /></div><div><div className="stat-num">{experimentList.length}</div><div className="stat-cap">可探索的动手实验</div></div></div>
      <div className="stat-cell" role="listitem"><div className="stat-ico"><IconHand size={18} /></div><div><div className="stat-num">4</div><div className="stat-cap">交互输入模态</div></div></div>
      <div className="stat-cell" role="listitem"><div className="stat-ico"><IconShield size={18} /></div><div><div className="stat-num" style={{ fontSize: 17 }}>本地优先</div><div className="stat-cap">隐私友好的学习体验</div></div></div>
    </div>

    {/* 基础教学快捷入口 */}
    <section className="section" aria-label="基础教学工具">
      <div className="section-head">
        <div><h2>开始一堂好课</h2><div className="section-sub">轻松启动基础教学，给课堂多一点自由</div></div>
        <button className="text-link" onClick={onGuide}>使用指南 <IconArrow size={12} /></button>
      </div>
      <div className="tool-grid">
        <button className="tool-card ppt" onClick={() => go('slides')}>
          <div className="tc-left">
            <div className="tool-icon" aria-hidden>▤</div>
            <h3>课件交互</h3>
            <p className="tc-desc">隔空演示，让讲解不被设备打断</p>
            <div className="tool-feats"><span>PPT 手势控制</span><span>激光指示</span><span>教学批注</span></div>
            <span className="tool-open">进入演示空间 →</span>
          </div>
          <svg className="tool-visual" viewBox="0 0 250 168" aria-hidden="true"><rect x="35" y="16" width="193" height="126" rx="13" fill="#d7cffd" opacity=".55" transform="rotate(7 130 79)" /><rect x="28" y="12" width="189" height="129" rx="11" fill="#fff" stroke="#d9d7ef" strokeWidth="2" /><rect x="40" y="25" width="164" height="11" rx="4" fill="#e7e4fb" /><rect x="40" y="48" width="74" height="6" rx="3" fill="#9c95db" /><rect x="40" y="59" width="91" height="5" rx="2" fill="#e6e7f2" /><path d="M140 105 159 89 175 99 194 73" fill="none" stroke="#9683e7" strokeWidth="4" strokeLinecap="round" /><circle cx="140" cy="105" r="4" fill="#9f8ae8" /><circle cx="159" cy="89" r="4" fill="#9f8ae8" /><circle cx="175" cy="99" r="4" fill="#9f8ae8" /><circle cx="194" cy="73" r="4" fill="#9f8ae8" /><circle cx="202" cy="123" r="17" fill="#7569d1" /><path d="m200 117 8 6-8 6z" fill="#fff" /></svg>
        </button>
        <button className="tool-card board" onClick={() => go('whiteboard')}>
          <div className="tc-left">
            <div className="tool-icon" aria-hidden>✎</div>
            <h3>隔空画板</h3>
            <p className="tc-desc">伸出手指，在空气中写下灵感</p>
            <div className="tool-feats"><span>隔空书写</span><span>绘图与擦除</span><span>画布操作</span></div>
            <span className="tool-open">打开创作画布 →</span>
          </div>
          <svg className="tool-visual" viewBox="0 0 250 168" aria-hidden="true"><rect x="29" y="19" width="193" height="126" rx="12" fill="#c6eee7" opacity=".7" transform="rotate(6 125 84)" /><rect x="23" y="13" width="190" height="128" rx="11" fill="#fff" stroke="#d3ebe8" strokeWidth="2" /><g stroke="#d2e9e8" strokeWidth="1" opacity=".9"><path d="M42 47h152M42 77h152M42 107h152" /></g><path d="M51 92Q72 30 97 91T147 90T193 65" stroke="#30b9a6" strokeWidth="4" fill="none" strokeLinecap="round" /><circle cx="50" cy="92" r="5" fill="#2fbea9" /><path d="m154 110 14-17 6 21" stroke="#9d90db" strokeWidth="3.5" fill="none" strokeLinecap="round" /><rect x="70" y="132" width="102" height="18" rx="9" fill="#fff" stroke="#c4e5df" /><circle cx="86" cy="141" r="5" fill="#31bcaa" /><circle cx="107" cy="141" r="5" fill="#a7a0eb" /><circle cx="128" cy="141" r="5" fill="#ffb28a" /><circle cx="149" cy="141" r="5" fill="#2b3651" /></svg>
        </button>
      </div>
    </section>

    {/* 多学科具身学习实验 */}
    <section className="section" ref={expRef} id="home-experiments" aria-label="学科实验">
      <div className="section-head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}><h2>探索具身学习</h2><span className="section-tag">DISCOVER</span></div>
          <div className="section-sub">用身体感受规律，用行动理解知识——{experimentList.length} 个实验全部离线运行</div>
        </div>
        <label className="search-box" style={{ width: 'min(280px, 100%)' }}>
          <IconSearch size={14} className="s-ico" />
          <input value={query} onChange={e => { onQuery(e.target.value); onSubject('全部'); }} placeholder="在实验列表中筛选…" aria-label="筛选实验" />
            {query && <button className="s-clear" aria-label="清除筛选" onClick={() => { onQuery(''); onSubject('全部'); }}><IconClose size={11} /></button>}
        </label>
      </div>
      <div className="filters" role="group" aria-label="按学科筛选">
        <button className={`filter${subject === '全部' ? ' active' : ''}`} onClick={() => { onSubject('全部'); onQuery(''); }}>全部探索</button>
        {subjectGroups.map(g => <button key={g.id} className={`filter${subject === g.title ? ' active' : ''}`} onClick={() => { onSubject(g.title); onQuery(''); }}>{SUBJECT_SHORT[g.title] ?? g.title}</button>)}
      </div>
      <div className="exp-grid">
        {visible.map(s => {
          const group = subjects.find(g => g.experiments.some(x => x.id === s.id));
          return <button key={s.id} className="exp-card" aria-label={`进入实验：${s.title}`} title={s.description} onClick={() => go(s.id)}>
            <div className={`exp-art ${SUBJECT_CLASS[group?.title ?? ''] ?? 'art-tool'}`}>
              <span className="art-tag">{(CATEGORY[s.id] ?? group?.title ?? '').toUpperCase()}</span>
              <Art id={s.id} />
            </div>
            <div className="exp-body">
              <div className="exp-cat">{CATEGORY[s.id] ?? group?.title}</div>
              <h3>{s.title}</h3>
              <p className="exp-desc">{s.description}</p>
              <div className="exp-foot">
                {(TAGS[s.id] ?? []).map(t => <span key={t} className="tag">{t}</span>)}
                <span className="exp-go" aria-hidden>→</span>
              </div>
            </div>
          </button>;
        })}
      </div>
      {matched.length === 0 && <div className="empty-tip">没有找到匹配的实验——试试更短的关键词，或切换学科筛选。</div>}
      {collapsed && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
        <button className="text-link" style={{ fontSize: 12.5 }} onClick={() => setExpanded(true)}>探索全部 {matched.length} 个实验 <IconArrow size={12} /></button>
      </div>}
      {expanded && matched.length > 6 && subject === '全部' && !query.trim() && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 18 }}>
        <button className="text-link" style={{ fontSize: 12.5 }} onClick={() => setExpanded(false)}>收起部分实验 ↑</button>
      </div>}
    </section>

    <div className="home-banner">
      <div><strong>每一个动作，都是一次发现。</strong><p>无需额外设备，打开摄像头，把抽象知识变成可以感知、操作与探索的世界。</p></div>
      <button onClick={onGuide}>了解交互方式 →</button>
    </div>
    <p className="help privacy-note">学习过程仅记录交互元数据（不含画面）；摄像头画面本地推理，不录制、不上传；语音识别由浏览器完成，不保存音频。</p>

    <div style={{ display: 'flex', justifyContent: 'center', padding: '26px 0 6px', opacity: .5 }} aria-hidden>
      <BrandMark size={54} id="home-foot" />
    </div>
  </section>;
}
