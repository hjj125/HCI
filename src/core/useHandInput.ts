import { useCallback, useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { PinchGate, numberToolPose } from './interaction';
export type HandSample = { x: number; y: number; phase: 'start' | 'update' | 'end' | 'cancel'; pinching: boolean; command?: 'undo' | 'pen' | 'eraser' | 'laser'; hands?: { x: number; y: number }[]; openPalm?: boolean };
export type HandStatusTexts = { idle?: string; pinching?: string; lost?: string };
export function useHandInput(onSample: (sample: HandSample) => void, options: { fistUndo?: boolean; background?: boolean; numberTools?: boolean; numberLaser?: boolean; statusTexts?: HandStatusTexts } = {}) {
 const settings=useRef(options);settings.current=options;
 const video = useRef<HTMLVideoElement>(null);
 const callback = useRef(onSample); callback.current=onSample;
 const stream = useRef<MediaStream|null>(null), model=useRef<HandLandmarker|null>(null), frame=useRef<ReturnType<typeof setTimeout>|null>(null), generation=useRef(0);
 const gate=useRef(new PinchGate());
 // 取消或丢失追踪后必须重新张开手，避免上一次捏合直接泄漏到新场景或新操作。
 const release=useRef(true);
 // 页面隐藏时主线程的定时器链会被浏览器钳制到约 1 秒一次，而挥手判定需要在
 // 80–700ms 窗口内累积至少 3 个采样；识别循环因此改由 Worker 定时器驱动，
 // Worker 中的定时不受页面可见性节流影响。
 const worker=useRef<Worker|null>(null);
 const workerInterval=useCallback(()=>worker.current?.postMessage(document.hidden?100:24),[]);
 const [status,setStatus]=useState('摄像头未启用'),[enabled,setEnabled]=useState(false),[loading,setLoading]=useState(false);
 const [cursor,setCursor]=useState<{x:number;y:number;pinching:boolean}|null>(null);
 const cancel=useCallback(()=>{ release.current=true; gate.current.reset(); callback.current({x:0,y:0,phase:'cancel',pinching:false});setCursor(null); },[]);
 const stop=useCallback(()=>{
   generation.current++; clearTimeout(frame.current ?? undefined);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;
   worker.current?.terminate();worker.current=null;document.removeEventListener('visibilitychange',workerInterval);
   model.current?.close();model.current=null;cancel();setEnabled(false);setLoading(false);setStatus('已关闭 · 可使用鼠标');
   if(video.current)video.current.srcObject=null;
 },[cancel,workerInterval]);
 const start=async()=>{
  if(loading||enabled)return;
  const id=++generation.current;setLoading(true);setStatus('加载本地手部模型…');
  let pendingModel:HandLandmarker|null=null, pendingStream:MediaStream|null=null;
  try {
   if(!navigator.mediaDevices?.getUserMedia)throw new Error('请在 localhost 或 HTTPS 下访问');
   const vision=await FilesetResolver.forVisionTasks('/mediapipe/wasm');
   const options={baseOptions:{modelAssetPath:'/mediapipe/hand_landmarker.task'},runningMode:'VIDEO' as const,numHands:2};
   try{pendingModel=await HandLandmarker.createFromOptions(vision,{...options,baseOptions:{...options.baseOptions,delegate:'GPU'}});}catch{pendingModel=await HandLandmarker.createFromOptions(vision,options);}
   if(id!==generation.current){pendingModel.close();return;}
   pendingStream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480},audio:false});
   if(id!==generation.current){pendingStream.getTracks().forEach(t=>t.stop());pendingModel.close();return;}
   const v=video.current!;v.srcObject=pendingStream;await v.play();
   if(id!==generation.current){pendingStream.getTracks().forEach(t=>t.stop());pendingModel.close();return;}
   stream.current=pendingStream;model.current=pendingModel;setEnabled(true);setLoading(false);setStatus('请将一只手放入画面');
   let previousTime=-1, smooth:{x:number;y:number}|null=null,wasTracked=false;
   release.current=true;
   let fistSince:number|null=null, fistFired=false;
   let lastPalm:{x:number;y:number}|null=null;
   let numberCmd:'pen'|'eraser'|'laser'|null=null, numberSince=0, numberFired=false;
   const lost=()=>{if(wasTracked)cancel();wasTracked=false;smooth=null;release.current=true;fistSince=null;fistFired=false;lastPalm=null;numberCmd=null;numberSince=0;numberFired=false;setStatus(settings.current.statusTexts?.lost??'追踪丢失 · 操作已取消，请张开手后重新捏合');};
   const loop=()=>{
    if(id!==generation.current)return;
    try{
     if(!pendingStream!.active){stop();return;}
     if(v.readyState>=2&&v.currentTime!==previousTime){
      previousTime=v.currentTime;const result=model.current!.detectForVideo(v,performance.now()),all=result.landmarks;
      if(!all.length) { if(wasTracked)lost(); }
      else {
       // 双手同时可见时“贴住”上一次的主手（按手掌中心最近距离），避免指针与挥手轨迹跳变。
       const palmOf=(l:typeof all[0])=>({x:1-(l[0].x+l[9].x+l[17].x)/3,y:(l[0].y+l[9].y+l[17].y)/3});
       let idx=0;
       if(all.length>1&&lastPalm){
        const d0=Math.hypot(palmOf(all[0]).x-lastPalm.x,palmOf(all[0]).y-lastPalm.y);
        const d1=Math.hypot(palmOf(all[1]).x-lastPalm.x,palmOf(all[1]).y-lastPalm.y);
        idx=d1<d0?1:0;
       }
       const p=all[idx];lastPalm=palmOf(all[idx]);
       const hands=all.length>=2?all.map(palmOf):undefined;
       wasTracked=true;const scale=Math.hypot(p[0].x-p[9].x,p[0].y-p[9].y)||.1;
       // 握拳为可选离散指令。
       const distance=(a:number,b:number)=>Math.hypot(p[a].x-p[b].x,p[a].y-p[b].y);
       const fist=[ [8,5], [12,9], [16,13], [20,17] ].every(([tip,base])=>distance(tip,0)<distance(base,0)*1.18);
       if(settings.current.fistUndo && fist){
        if(gate.current.active){gate.current.reset();callback.current({x:0,y:0,phase:'end',pinching:false});}
        fistSince??=performance.now();release.current=true;smooth=null;setCursor(null);
         setStatus(fistFired?'已撤销 · 张开手继续':'握拳保持 0.6 秒撤销');
         if(!fistFired&&performance.now()-fistSince>=600){fistFired=true;callback.current({x:0,y:0,phase:'update',pinching:false,command:'undo'});}
         schedule();return;
       }
       fistSince=null;fistFired=false;
       // 数字手势：白板内比 2/3 选画笔/橡皮；课件视图比 2 开关激光笔。
       // 稳定保持 0.6 秒触发一次；捏合中不判定，触发后需收起手势才能再次触发。
       if((settings.current.numberTools||settings.current.numberLaser)&&!gate.current.active&&!release.current){
        const up=(tip:number,pip:number)=>distance(tip,0)>distance(pip,0)*1.12;
        const pose=numberToolPose([up(8,6),up(12,10),up(16,14),up(20,18)]);
        const cmd:'pen'|'eraser'|'laser'|null=settings.current.numberLaser&&pose==='pen'?'laser':pose;
        if(cmd){
         if(numberCmd!==cmd){numberCmd=cmd;numberSince=performance.now();}
         const hold=cmd==='pen'?'切换为画笔':cmd==='eraser'?'切换为橡皮':'开关激光笔';
         setStatus(numberFired?(cmd==='laser'?'激光笔命令已发出 · 收起手势继续':`已是${cmd==='pen'?'画笔':'橡皮'} · 收起手势继续`):`保持 ${cmd==='eraser'?'3':'2'} 指 0.6 秒${hold}`);
         if(!numberFired&&performance.now()-numberSince>=600){numberFired=true;callback.current({x:0,y:0,phase:'update',pinching:false,command:cmd});}
         schedule();return;
        }
        numberCmd=null;numberSince=0;numberFired=false;
       }
       const ratio=Math.hypot(p[8].x-p[4].x,p[8].y-p[4].y)/scale;
       // 指针使用镜像归一化坐标。
       const x=Math.max(0,Math.min(1,1-p[8].x)),y=Math.max(0,Math.min(1,p[8].y));
       smooth=smooth?{x:smooth.x*.3+x*.7,y:smooth.y*.3+y*.7}:{x,y};
       if(release.current){if(ratio>.48)release.current=false;gate.current.reset();}
       const change=release.current?null:gate.current.update(ratio,performance.now());
       setCursor({...smooth,pinching:gate.current.active});
       setStatus(release.current?'请先张开拇指和食指':gate.current.active?(settings.current.statusTexts?.pinching??'捏合中 · 松开提交操作'):(settings.current.statusTexts?.idle??'追踪就绪 · 指向目标后捏合'));
       const openPalm=[[8,6],[12,10],[16,14],[20,18]].every(([tip,pip])=>distance(tip,0)>distance(pip,0)*1.12)&&!gate.current.active;
       callback.current({...smooth,phase:change==='start'?'start':change==='end'?'end':'update',pinching:gate.current.active,hands,openPalm});
      }
     }
    }catch(error){console.error(error);stop();setStatus('识别中断，请重新启用摄像头或使用鼠标');return;}
    schedule();
   };
   const schedule=()=>{if(!worker.current)frame.current=setTimeout(loop,document.hidden?100:24);};
   try{
    if(typeof Worker!=='undefined'){
     const source='let t=0;onmessage=e=>{clearInterval(t);if(e.data>0)t=setInterval(()=>postMessage(0),e.data)}';
     const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
     try{
      const w=new Worker(url);
      w.onmessage=()=>loop();
      // Worker 异常时退回主线程定时器，识别不至于完全中断。
      w.onerror=()=>{if(worker.current===w){worker.current=null;schedule();}};
      worker.current=w;
      document.addEventListener('visibilitychange',workerInterval);
      workerInterval();
      if(id!==generation.current){w.terminate();if(worker.current===w)worker.current=null;document.removeEventListener('visibilitychange',workerInterval);return;}
     }finally{URL.revokeObjectURL(url);}
    }
   }catch{/* Worker 不可用时由 schedule() 退回主线程定时器 */}
   loop();
  }catch(error){pendingStream?.getTracks().forEach(t=>t.stop());pendingModel?.close();if(video.current)video.current.srcObject=null;setLoading(false);setEnabled(false);setStatus(`无法启用：${error instanceof Error?error.message:'请检查权限和模型文件'}`);}
 };
 useEffect(()=>{const hide=()=>{if(document.hidden&&!settings.current.background)stop();};document.addEventListener('visibilitychange',hide);return()=>{document.removeEventListener('visibilitychange',hide);document.removeEventListener('visibilitychange',workerInterval);generation.current++;clearTimeout(frame.current ?? undefined);worker.current?.terminate();worker.current=null;stream.current?.getTracks().forEach(t=>t.stop());model.current?.close();};},[stop,workerInterval]);
 useEffect(()=>{if(document.hidden&&!options.background&&enabled)stop();},[options.background,enabled,stop]);
 return{video,start,stop,cancel,status,enabled,loading,cursor};
}
