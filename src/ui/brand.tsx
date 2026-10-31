/** 品牌·灵境智学 Logo（内联 SVG 重绘）：拱门 + 翻开的书 + 起身人形 + 轨道星球。
 *  纯矢量、离线可用；brand=侧栏彩色版，mono=单色（页脚/水印用）。 */

export function BrandMark({ size = 42, id = 'bm' }: { size?: number; id?: string }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-arch`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#3f8bfe" /><stop offset=".55" stopColor="#5f7cf6" /><stop offset="1" stopColor="#8f6cf0" />
      </linearGradient>
      <linearGradient id={`${id}-book`} x1="0" y1="1" x2="1" y2="0">
        <stop stopColor="#2ea7e8" /><stop offset=".5" stopColor="#4f7df4" /><stop offset="1" stopColor="#8f6cf0" />
      </linearGradient>
      <linearGradient id={`${id}-orbit`} x1="0" y1="0" x2="1" y2="0">
        <stop stopColor="#65e3d5" /><stop offset="1" stopColor="#4f8bfe" />
      </linearGradient>
    </defs>
    {/* 轨道（后） */}
    <ellipse cx="33" cy="30" rx="27" ry="9" fill="none" stroke={`url(#${id}-orbit)`} strokeWidth="2.4" strokeLinecap="round" strokeDasharray="46 14 30 10" opacity=".85" transform="rotate(-14 33 30)" />
    {/* 拱门 */}
    <path d="M21 47V25.5C21 15.8 25.6 10 32.6 10c7 0 11.4 5.8 11.4 15.5V47" fill="none" stroke={`url(#${id}-arch)`} strokeWidth="5.6" strokeLinecap="round" />
    <path d="M25.5 45V26c0-6.4 2.8-10.4 7-10.4" fill="none" stroke="#ffffff" strokeOpacity=".5" strokeWidth="1.6" strokeLinecap="round" />
    {/* 星 */}
    <path d="m32.5 15 1.5 3.6 3.6 1.5-3.6 1.5-1.5 3.6-1.5-3.6-3.6-1.5 3.6-1.5z" fill="#cfe4ff" />
    {/* 起身人形 */}
    <circle cx="31.4" cy="26.6" r="3.4" fill="#eaf3ff" />
    <path d="M31.8 31c-2.6 3.4-2 6.2-4.4 9.6-1.6 2.3-3.4 3.6-5.6 4.6 4.8.5 8.8-1 11.4-4.4 2.2-2.9 2.6-6.4 1.4-9.4z" fill="#eaf3ff" opacity=".95" />
    {/* 翻开的书 */}
    <path d="M6.5 44.5c8-4.4 16.5-4.6 24.5.4v13.6c-8-5-16.5-4.8-24.5-.4z" fill={`url(#${id}-book)`} opacity=".92" />
    <path d="M57.5 44.5c-8-4.4-16.5-4.6-24.5.4v13.6c8-5 16.5-4.8 24.5-.4z" fill={`url(#${id}-arch)`} opacity=".95" />
    <path d="M31 45v13.4" stroke="#dcebff" strokeWidth="1.6" strokeLinecap="round" />
    {/* 星球（前） */}
    <circle cx="54" cy="20.5" r="3.4" fill={`url(#${id}-orbit)`} />
    <circle cx="53" cy="19.5" r="1.1" fill="#ffffff" opacity=".85" />
  </svg>;
}
