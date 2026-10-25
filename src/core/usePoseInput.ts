import { useEffect, useRef, useState, type RefObject } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import type { PoseSample } from './services';

/** 姿态识别钩子：与手部识别共享同一个 <video> 元素（各自独立循环读 currentTime，
 *  不开第二个摄像头流）。仅在激活场景注册了姿态策略（active）时逐帧推理，
 *  其他场景零开销。模型本地加载（public/mediapipe/pose_landmarker_full.task）。
 */
export function usePoseInput(
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  active: boolean,
  onSample: (sample: PoseSample) => void,
) {
  const [status, setStatus] = useState('姿态识别未启用');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const landmarker = useRef<PoseLandmarker | null>(null);
  const cb = useRef(onSample); cb.current = onSample;

  useEffect(() => {
    if (!enabled || !active) {
      setStatus(enabled ? '姿态识别待机（进入生物实验时启用）' : '姿态识别未启用');
      return;
    }
    const id = ++generation.current;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      setLoading(true); setStatus('加载本地姿态模型…');
      try {
        if (!landmarker.current) {
          const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
          const options = {
            baseOptions: { modelAssetPath: '/mediapipe/pose_landmarker_full.task', delegate: 'GPU' as const },
            runningMode: 'VIDEO' as const, numPoses: 1,
          };
          try { landmarker.current = await PoseLandmarker.createFromOptions(vision, options); }
          catch { landmarker.current = await PoseLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }); }
        }
        if (cancelled || id !== generation.current) return;
        setLoading(false); setStatus('姿态识别运行中 · 骨架仅本地绘制');
        let prev = -1;
        const loop = () => {
          if (cancelled || id !== generation.current) return;
          const v = videoRef.current;
          try {
            if (v && v.readyState >= 2 && v.videoWidth > 0 && v.currentTime !== prev) {
              prev = v.currentTime;
              const result = landmarker.current!.detectForVideo(v, performance.now());
              const lm = result.landmarks && result.landmarks[0];
              if (lm) cb.current({ landmarks: lm.map(p => ({ x: 1 - p.x, y: p.y, z: p.z ?? 0, visibility: p.visibility ?? 1 })) });
            }
          } catch (error) { console.error(error); setStatus('姿态识别中断，请重新进入场景'); }
          timer = setTimeout(loop, 33);
        };
        loop();
      } catch (error) {
        setLoading(false);
        setStatus(`姿态模型不可用（运行 node scripts/setup-model.mjs）${error instanceof Error ? '：' + error.message.slice(0, 60) : ''}`);
      }
    })();
    return () => { cancelled = true; generation.current++; if (timer) clearTimeout(timer); };
  }, [enabled, active, videoRef]);

  return { status, loading };
}
