// zzz1213 — parse a PDF in a SEPARATE Node process with a hard time and memory limit.
//
// Why. pdf-parse (pdf.js) runs synchronously inside the web server. A large or malformed investor deck can block the
// event loop for minutes or blow up memory, and then every page of the site stops answering (2 Nov 2026, after the
// radar began reading 5–25 MB presentations: even /api/healthz timed out). A child process that is killed after
// `timeoutMs` can never take the web server down with it.
import { spawn } from 'child_process';

export interface IsolatedParse { text: string; pages: number }
export interface IsolatedFail { error: string }

// pdf.js prints font warnings with console.log (stdout): silence console output in the child and mark the result line.
const MARK = '@@MC_PDF_RESULT@@';
const SCRIPT = `
console.log = console.info = console.warn = console.debug = () => {};
let p; try { p = require('pdf-parse/lib/pdf-parse.js'); } catch (e) { p = require('pdf-parse'); }
const ch = []; process.stdin.on('data', (d) => ch.push(d));
process.stdin.on('end', async () => {
  try { const o = await p(Buffer.concat(ch)); process.stdout.write('\\n${MARK}' + JSON.stringify({ text: o.text || '', pages: o.numpages || 0 })); }
  catch (e) { process.stdout.write('\\n${MARK}' + JSON.stringify({ error: String((e && e.message) || e).slice(0, 200) })); }
});`;

/** How many parses may run at once (each is its own process). */
const MAX_PARALLEL = 2;
let running = 0;
const waiters: Array<() => void> = [];
async function slot(): Promise<() => void> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  running++;
  return () => { running--; const w = waiters.shift(); if (w) w(); };
}

export async function parsePdfIsolated(buf: Buffer, opts: { timeoutMs?: number; maxHeapMb?: number } = {}): Promise<IsolatedParse | IsolatedFail> {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  const heap = opts.maxHeapMb ?? 512;
  const release = await slot();
  try {
    return await new Promise<IsolatedParse | IsolatedFail>((resolve) => {
      let out = '';
      let done = false;
      const finish = (v: IsolatedParse | IsolatedFail) => { if (!done) { done = true; resolve(v); } };
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(process.execPath, [`--max-old-space-size=${heap}`, '-e', SCRIPT], {
          cwd: process.cwd(), stdio: ['pipe', 'pipe', 'ignore'],
          env: { ...process.env, NODE_OPTIONS: '' },
        });
      } catch (e: any) { finish({ error: `could not start parser: ${e?.message || e}` }); return; }
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish({ error: `parse timeout after ${Math.round(timeoutMs / 1000)} s` }); }, timeoutMs);
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (d: string) => { if (out.length < 6_000_000) out += d; });
      child.on('error', (e) => { clearTimeout(timer); finish({ error: `parser error: ${e.message}` }); });
      child.on('close', (code) => {
        clearTimeout(timer);
        try {
          const at = out.lastIndexOf(MARK);
          const j = JSON.parse(at >= 0 ? out.slice(at + MARK.length) : out);
          if (j && typeof j.error === 'string') finish({ error: j.error });
          else finish({ text: String(j?.text || ''), pages: Number(j?.pages || 0) });
        } catch { finish({ error: code ? `parser exited ${code} (out of memory or crash)` : 'parser returned nothing' }); }
      });
      child.stdin!.on('error', () => { /* child died early: reported on close */ });
      child.stdin!.end(buf);
    });
  } finally { release(); }
}
