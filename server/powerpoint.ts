import { execFile } from 'node:child_process';
import type { Plugin, Connect } from 'vite';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
export type PowerPointAction = 'status' | 'next' | 'previous';
export type PowerPointState = {
  connected: boolean; presenting: boolean; file?: string; current?: number; total?: number; error?: string;
};
// Connect only to an existing Office instance. Never launch, save or close user documents.
const powershell = String.raw`
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
$ppt = $null
$show = $null
$window = $null
$view = $null
$presentation = $null
try {
  $ppt = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
  $show = $ppt.SlideShowWindows
  if ($show.Count -gt 1) { throw '检测到多个放映窗口，请仅保留一个放映后重试。' }
  if ($show.Count -eq 1) {
    $window = $show.Item(1)
    $presentation = $window.Presentation
    $view = $window.View
    if ($env:EMBODIED_ACTION -eq 'next') { $view.Next() }
    elseif ($env:EMBODIED_ACTION -eq 'previous') { $view.Previous() }
    $result = @{ connected = $true; presenting = $true; file = [string]$presentation.Name; current = [int]$view.CurrentShowPosition; total = [int]$presentation.Slides.Count }
  } else {
    if ($ppt.Presentations.Count -eq 0) { throw '请先在 PowerPoint 中打开一个演示文稿。' }
    $presentation = $ppt.ActivePresentation
    $result = @{ connected = $true; presenting = $false; file = [string]$presentation.Name; current = 0; total = [int]$presentation.Slides.Count }
    if ($env:EMBODIED_ACTION -ne 'status') { $result.error = '尚未开始放映，请在 PowerPoint 中按 F5，或选择窗口放映。' }
  }
  $result | ConvertTo-Json -Compress
} catch {
  @{ connected = $false; presenting = $false; error = ('PowerPoint 连接或控制失败：' + $_.Exception.Message) } | ConvertTo-Json -Compress
} finally {
  foreach ($obj in @($view, $presentation, $window, $show, $ppt)) {
    if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($obj)
    }
  }
}
`;

export async function controlPowerPoint(action: PowerPointAction): Promise<PowerPointState> {
  if (process.platform !== 'win32') return { connected: false, presenting: false, error: '此功能仅支持 Windows 桌面版 PowerPoint。' };
  try {
    // EncodedCommand avoids console code-page corruption in Chinese file names/errors.
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(powershell, 'utf16le').toString('base64'),
    ], {
      windowsHide: true, timeout: 7000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      env: { ...process.env, EMBODIED_ACTION: action },
    });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as PowerPointState;
  } catch {
    return { connected: false, presenting: false, error: '本机控制超时或 PowerShell 不可用。请关闭 PowerPoint 弹窗，并确保浏览器服务与 PowerPoint 使用同一 Windows 用户、相同权限级别。' };
  }
}

export function createPowerPointMiddleware(
  control: (action: PowerPointAction) => Promise<PowerPointState> = controlPowerPoint,
): Connect.NextHandleFunction {
  let busy = false, lastCommand = 0;
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    const host = req.headers.host ?? '';
    // Local-only, same-origin, non-simple POST. Never enable CORS for this desktop bridge.
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) ||
      req.headers['x-embodiededu'] !== 'local-control') {
      send(403, { error: '仅允许本机工作台访问 PowerPoint 控制接口。' }); return;
    }
    const action = new URL(req.url ?? '/', 'http://localhost').searchParams.get('action') ?? 'status';
    if (req.method !== 'POST' || !['status', 'next', 'previous'].includes(action)) {
      send(400, { error: '无效的 PowerPoint 控制请求。' }); return;
    }
    if (busy || (action !== 'status' && Date.now() - lastCommand < 900)) {
      send(429, { error: '正在处理或操作过快，请稍后重试。' }); return;
    }
    busy = true;
    if (action !== 'status') lastCommand = Date.now();
    try {
      const result = await control(action as PowerPointAction);
      send(result.error ? 409 : 200, result);
    } catch {
      send(500, { error: '本机 PowerPoint 服务执行异常。' });
    } finally { busy = false; }
  };
}

export function powerPointPlugin(): Plugin {
  return {
    name: 'embodiededu-powerpoint',
    configureServer(server) { server.middlewares.use('/api/powerpoint', createPowerPointMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use('/api/powerpoint', createPowerPointMiddleware()); },
  };
}
