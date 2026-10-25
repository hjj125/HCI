import { mkdir, copyFile, writeFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
const dir = new URL('../public/mediapipe/', import.meta.url);
await mkdir(new URL('wasm/', dir), { recursive: true });
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  await copyFile(new URL(`../node_modules/@mediapipe/tasks-vision/wasm/${file}`, import.meta.url), new URL(`wasm/${file}`, dir));
}
// 模型已存在时跳过（脚本可重复执行）。
async function download(url, file) {
  try {
    const info = await stat(new URL(file, dir));
    if (info.size > 1024) { console.log(`已存在，跳过 ${file}`); return; }
  } catch { /* 不存在则下载 */ }
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`模型下载失败: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(new URL(file, dir)));
  await writeFile(new URL(file, dir), new Uint8Array(0), { flag: 'r+' }).catch(() => { }); // 保持管道关闭后再校验
  console.log(`已下载 ${file}`);
}
await download('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task', 'hand_landmarker.task');
await download('https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task', 'pose_landmarker_full.task');
console.log('手势/姿态模型与 WASM 已保存到 public/mediapipe。后续使用无需外部模型请求。');
