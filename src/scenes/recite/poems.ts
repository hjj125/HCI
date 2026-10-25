/** 篇目库：公开领域课标古诗词（版本按通行教材，异文差异以界面备注说明）。 */
export type Poem = { id: string; title: string; author: string; sentences: string[] };

export const POEMS: readonly Poem[] = [
  { id: 'jingyesi', title: '静夜思', author: '唐·李白', sentences: ['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。'] },
  { id: 'chunxiao', title: '春晓', author: '唐·孟浩然', sentences: ['春眠不觉晓，', '处处闻啼鸟。', '夜来风雨声，', '花落知多少。'] },
  { id: 'guanquelou', title: '登鹳雀楼', author: '唐·王之涣', sentences: ['白日依山尽，', '黄河入海流。', '欲穷千里目，', '更上一层楼。'] },
  { id: 'lushan', title: '望庐山瀑布', author: '唐·李白', sentences: ['日照香炉生紫烟，', '遥看瀑布挂前川。', '飞流直下三千尺，', '疑是银河落九天。'] },
  { id: 'yonge', title: '咏鹅', author: '唐·骆宾王', sentences: ['鹅，鹅，鹅，', '曲项向天歌。', '白毛浮绿水，', '红掌拨清波。'] },
  { id: 'minnong', title: '悯农', author: '唐·李绅', sentences: ['锄禾日当午，', '汗滴禾下土。', '谁知盘中餐，', '粒粒皆辛苦。'] },
  { id: 'jueju', title: '绝句', author: '唐·杜甫', sentences: ['两个黄鹂鸣翠柳，', '一行白鹭上青天。', '窗含西岭千秋雪，', '门泊东吴万里船。'] },
  { id: 'jiangxue', title: '江雪', author: '唐·柳宗元', sentences: ['千山鸟飞绝，', '万径人踪灭。', '孤舟蓑笠翁，', '独钓寒江雪。'] },
];

/** 全文（拼接句）。 */
export const poemText = (p: Poem) => p.sentences.join('');
