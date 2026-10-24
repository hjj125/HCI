import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createPowerPointMiddleware, type PowerPointState } from './powerpoint';
function call(middleware: ReturnType<typeof createPowerPointMiddleware>, options: {host?:string;origin?:string;token?:string;action?:string;method?:string}={}) {
 const req=Object.assign(new EventEmitter(),{url:`/api/powerpoint?action=${options.action??'status'}`,method:options.method??'POST',headers:{host:options.host??'127.0.0.1:5173',origin:options.origin??'http://127.0.0.1:5173','x-embodiededu':options.token??'local-control'}});
 const headers:Record<string,string>={};const res:any={statusCode:0,setHeader:(k:string,v:string)=>headers[k]=v,end:(v:string)=>{res.body=v;}};
 return middleware(req as any,res).then(()=>({status:res.statusCode,body:JSON.parse(res.body),headers}));
}
describe('本机 PowerPoint API 安全和行为',()=>{
 it('只接受本机来源并返回放映状态',async()=>{const fn=vi.fn(async():Promise<PowerPointState>=>({connected:true,presenting:true,file:'demo.pptx',current:2,total:9}));const r=await call(createPowerPointMiddleware(fn));expect(r.status).toBe(200);expect(r.body.current).toBe(2);expect(fn).toHaveBeenCalledWith('status');});
 it('拒绝远端主机',async()=>{const fn=vi.fn(async()=>({connected:true,presenting:true}));const r=await call(createPowerPointMiddleware(fn),{host:'evil.example'});expect(r.status).toBe(403);expect(fn).not.toHaveBeenCalled();});
 it('拒绝跨源请求',async()=>{const r=await call(createPowerPointMiddleware(),{origin:'http://evil.example'});expect(r.status).toBe(403);});
 it('拒绝缺少本地请求标记',async()=>{const r=await call(createPowerPointMiddleware(),{token:''});expect(r.status).toBe(403);});
 it('拒绝过快重复指令',async()=>{const fn=vi.fn(async():Promise<PowerPointState>=>({connected:true,presenting:true}));const middleware=createPowerPointMiddleware(fn);const first=await call(middleware,{action:'next'});const second=await call(middleware,{action:'next'});expect(first.status).toBe(200);expect(second.status).toBe(429);expect(fn).toHaveBeenCalledTimes(1);});
 it('说明未开始放映的原因',async()=>{const fn=vi.fn(async():Promise<PowerPointState>=>({connected:true,presenting:false,error:'尚未开始放映'}));const r=await call(createPowerPointMiddleware(fn),{action:'next'});expect(r.status).toBe(409);expect(r.body.error).toContain('尚未');});
});
