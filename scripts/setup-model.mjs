import { mkdir, copyFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
const dir = new URL('../public/mediapipe/', import.meta.url);
await mkdir(new URL('wasm/', dir), { recursive: true });
for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
 await copyFile(new URL(`../node_modules/@mediapipe/tasks-vision/wasm/${file}`, import.meta.url), new URL(`wasm/${file}`, dir));
}
const response = await fetch('https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task');
if (!response.ok || !response.body) throw new Error(`模型下载失败: ${response.status}`);
await pipeline(Readable.fromWeb(response.body), createWriteStream(new URL('hand_landmarker.task', dir)));
console.log('手势模型与 WASM 已保存到 public/mediapipe。后续使用无需外部模型请求。');
