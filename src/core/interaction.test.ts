import { describe, it, expect } from 'vitest';
import { InteractionBus, PinchGate, numberToolPose, matchVoiceCommand } from './interaction';
describe('交互内核',()=>{
 it('捏合持续确认、滞回和释放',()=>{const g=new PinchGate();expect(g.update(.2,0)).toBeNull();expect(g.update(.2,100)).toBe('start');expect(g.update(.35,110)).toBeNull();expect(g.active).toBe(true);expect(g.update(.5,120)).toBe('end');expect(g.active).toBe(false);});
 it('失去追踪后必须重新确认',()=>{const g=new PinchGate();g.update(.2,0);g.update(.2,100);g.reset();expect(g.update(.2,200)).toBeNull();expect(g.active).toBe(false);});
 it('事件订阅和解除',()=>{const b=new InteractionBus();let calls=0;const off=b.subscribe(()=>calls++);b.emit({scene:'slides',source:'mouse',intent:'next',phase:'end'});off();b.emit({scene:'slides',source:'mouse',intent:'next',phase:'end'});expect(calls).toBe(1);});
 it('数字手势选择白板工具',()=>{
  const f=(a:boolean,b:boolean,c:boolean,d:boolean)=>[a,b,c,d] as [boolean,boolean,boolean,boolean];
  expect(numberToolPose(f(true,true,false,false))).toBe('pen');      // 比 2
  expect(numberToolPose(f(true,true,true,false))).toBe('eraser');   // 比 3
  expect(numberToolPose(f(true,false,false,false))).toBeNull();     // 单指=指向，不作为命令
  expect(numberToolPose(f(true,true,true,true))).toBeNull();        // 四指张开
  expect(numberToolPose(f(false,false,false,false))).toBeNull();    // 握拳
  expect(numberToolPose(f(false,true,false,false))).toBeNull();     // 只伸中指
 });
 it('语音命令短语匹配',()=>{
  expect(matchVoiceCommand('下一页')!.intent).toBe('next');
  expect(matchVoiceCommand('请翻到上一页，谢谢')!.intent).toBe('previous');
  expect(matchVoiceCommand('打开白板')).toEqual({intent:'switch',value:'whiteboard'});
  expect(matchVoiceCommand('我们看几何')).toEqual({intent:'switch',value:'geometry'});
  expect(matchVoiceCommand('关闭语音')!.intent).toBe('voice-off');
  expect(matchVoiceCommand('激光笔')).toEqual({intent:'laser'});
  expect(matchVoiceCommand('今天天气不错')).toBeNull();
 });
});
