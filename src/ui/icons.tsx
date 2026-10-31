/** 统一图标库（Lucide 风格线性 SVG，1.8 描边、圆角端点）。
 *  顶部工具栏、统计区、帮助弹窗等界面图标一律从此取用，不再混用 Emoji。 */

type P = { size?: number; className?: string };

function Base({ size = 18, className, children }: P & { children: React.ReactNode }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>;
}

export const IconSearch = (p: P) => <Base {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.8-3.8" /></Base>;
export const IconHome = (p: P) => <Base {...p}><path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 21v-7h6v7" /></Base>;
export const IconBook = (p: P) => <Base {...p}><path d="M12 6c-2.8-2-6.5-2-9.5-.8V19c3-1.2 6.7-1.2 9.5.8 2.8-2 6.5-2 9.5-.8V5.2C18.5 4 14.8 4 12 6z" /><path d="M12 6v13.8" /></Base>;
export const IconCube = (p: P) => <Base {...p}><path d="m12 2.5 8 4.5v10l-8 4.5-8-4.5V7z" /><path d="m4 7 8 4.5L20 7M12 11.5V21.5" /></Base>;
export const IconHand = (p: P) => <Base {...p}><path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0-5.5v-1a1.5 1.5 0 0 1 3 0V11m0-4.5a1.5 1.5 0 0 1 3 0V13m-9-1.5-1.8-2.2A1.6 1.6 0 0 0 3.4 11l3.1 6.2A6 6 0 0 0 11.8 21h1.7a5.5 5.5 0 0 0 5.5-5.5V6.5" /></Base>;
export const IconShield = (p: P) => <Base {...p}><path d="M12 2.5 4.5 6v6c0 4.6 3.2 7.6 7.5 9.5 4.3-1.9 7.5-4.9 7.5-9.5V6z" /><path d="m8.8 11.8 2.2 2.2 4.4-4.5" /></Base>;
export const IconSpark = (p: P) => <Base {...p}><path d="m12 3 1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z" /><path d="M19 3.5v3M20.5 5h-3" /></Base>;
export const IconHelp = (p: P) => <Base {...p}><circle cx="12" cy="12" r="9.2" /><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.2-2.8 4.3M12 17.6h.01" /></Base>;
export const IconArrow = (p: P) => <Base {...p}><path d="M4.5 12h15m-6.5-6 6 6-6 6" /></Base>;
export const IconClose = (p: P) => <Base {...p}><path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" /></Base>;
export const IconCamera = (p: P) => <Base {...p}><rect x="2.8" y="6.5" width="18.4" height="13" rx="2.6" /><circle cx="12" cy="13" r="3.2" /><path d="m8.5 6.5 1.2-2.6h4.6l1.2 2.6" /></Base>;
export const IconMic = (p: P) => <Base {...p}><rect x="9" y="2.8" width="6" height="11.4" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.2" /></Base>;
export const IconGrid = (p: P) => <Base {...p}><rect x="3.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.4" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.4" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.4" /></Base>;
export const IconChevron = (p: P) => <Base {...p}><path d="m9 5.5 6.5 6.5L9 18.5" /></Base>;
export const IconMenu = (p: P) => <Base {...p}><path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17" /></Base>;
export const IconPlay = (p: P) => <Base {...p}><circle cx="12" cy="12" r="9.2" /><path d="m10 8.2 5.4 3.8-5.4 3.8z" /></Base>;
export const IconSignal = (p: P) => <Base {...p}><path d="M4 19h2.5v-4H4zM10 19V9h2.5v10zM16 19V4.5h2.5V19z" /></Base>;
