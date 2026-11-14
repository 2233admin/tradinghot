#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { lstat, mkdir, unlink, chmod } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

const sources = {
  'cn-eastmoney-guba': { host: 'guba.eastmoney.com', path: /^\/news,[a-z\d]+,\d+\.html$/i, selector: '.newstext', date: '#newscontent', remove: '.news_source' },
  'cn-tgb-index': { host: 'www.tgb.cn', path: /^\/a\/[a-z\d]+$/i, selector: '#first.article-text', date: '.article-data' },
  'cn-jisilu': { host: 'www.jisilu.cn', path: /^\/question\/\d+$/, selector: '.aw-question-detail-txt.markitup-box', date: '.aw-question-detail-meta' },
  'cn-jiuyangongshe': { host: 'www.jiuyangongshe.com', path: /^\/a\/[a-z\d]+$/i, selector: '.text-box.text-justify.fsDetail', date: '.detail-container' },
  'newsnow-linuxdo-latest': { host: 'linux.do', path: /^\/latest$/, search: '?order=created', kind: 'linux-list', selector: 'tr.topic-list-item' },
  'newsnow-linuxdo-hot': { host: 'linux.do', path: /^\/top$/, search: '?period=daily', kind: 'linux-list', selector: 'tr.topic-list-item' },
  'truthsocial-donald-trump': { host: 'truthsocial.com', path: /^\/api\/v1\/accounts\/107780257626128497\/statuses$/, kind: 'truth-api', navigate: 'https://truthsocial.com/@realDonaldTrump' },
};
const maxActive = 3;
const maxQueued = 12;
const requestLimit = 8192;
const responseLimit = 120_000;
const bodyLimit = 48_000;
const timeoutMs = 30_000;
const socketPath = process.env.BROWSERMCP_BRIDGE_SOCKET || path.join(process.env.XDG_RUNTIME_DIR || path.join('/run/user', String(process.getuid())), 'tradinghot-browsermcp', 'bridge.sock');
const launcher = process.env.BROWSERMCP_LAUNCHER || path.join(os.homedir(), '.browsermcp/bin/browsermcp-launcher');
process.umask(0o077);
if (!path.isAbsolute(socketPath)) throw new Error('bridge socket path must be absolute');
let active = 0;
const waiting = [];

function accepted(request) {
  if (!request || typeof request !== 'object' || Object.keys(request).some(k => k !== 'source' && k !== 'url')) return null;
  const rule = Object.hasOwn(sources, request.source) ? sources[request.source] : null;
  if (!rule || typeof request.url !== 'string' || request.url.length > 2048) return null;
  try {
    const u = new URL(request.url);
    if (u.protocol !== 'https:' || u.hostname !== rule.host || u.port || u.username || u.password || u.hash || !rule.path.test(u.pathname)) return null;
    if (rule.kind === 'truth-api') {
      if ([...u.searchParams.keys()].some(key => key !== 'max_id') || u.searchParams.getAll('max_id').length > 1 || (u.searchParams.has('max_id') && !/^\d{1,24}$/.test(u.searchParams.get('max_id')))) return null;
    } else if (u.search !== (rule.search || '')) return null;
    return { url: rule.navigate || u.href, apiUrl: rule.kind === 'truth-api' ? u.href : null, origin: u.origin, selector: rule.selector, date: rule.date, remove: rule.remove || '', kind: rule.kind || 'body' };
  } catch { return null; }
}

function browserScript(target) {
  return `
    let target = ${JSON.stringify(target)};
    let t = await browser.tabs.new();
    let answer;
    try {
      let events = await t.cdp.watch('Fetch.requestPaused', { capacity: 100 });
      let mainFrame = (await t.cdp.send('Page.getFrameTree')).frameTree.frame.id;
      await t.cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Document' }] });
      await browser.chrome.call('tabs.update', [Number(t.id), { url: target.url }]);
      let count = 0, blocked = 0, complete = false;
      const sameDocument = (a, b) => {
        try {
          const x = new URL(a), y = new URL(b);
          const norm = u => u.origin + u.pathname.replace(/\\/+$/, '') + u.search;
          return norm(x) === norm(y);
        } catch { return false; }
      };
      for (let end = Date.now() + 20000; Date.now() < end;) {
        let batch = await events.read();
        if (batch.dropped || batch.reset || batch.closed) throw Error('navigation interception lost');
        for (let entry of batch.entries) {
          let p = entry.params;
          if (!p?.requestId) continue;
          if (p.frameId === mainFrame) count++;
          if (p.frameId === mainFrame && sameDocument(p.request.url, target.url)) await t.cdp.send('Fetch.continueRequest', { requestId: p.requestId });
          else {
            if (p.frameId === mainFrame) blocked++;
            await t.cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' });
          }
        }
        let state = await browser.chrome.call('tabs.get', [Number(t.id)]);
        // A cached page never asks the network, so the tab's own address is the proof it arrived.
        if (state.status === 'complete' && (count > 0 || sameDocument(state.url, target.url))) { complete = true; break; }
        await new Promise(r => setTimeout(r, 40));
      }
      if (!complete) {
        // A page that keeps loading never reports "complete": the document itself is enough.
        for (let end = Date.now() + 12000; Date.now() < end;) {
          let s = await t.evaluate(() => ({ ready: document.readyState, href: location.href })).catch(() => null);
          if (s && sameDocument(s.href, target.url) && s.ready !== 'loading') { complete = true; break; }
          await new Promise(r => setTimeout(r, 250));
        }
      }
      if (!complete) throw Error('navigation did not complete');
      if (blocked) answer = { ok: false, code: 'no_content' };
      else if (target.kind === 'truth-api') {
        let v = await t.evaluate(async s => {
          const response = await fetch(s.apiUrl, { headers: { accept: 'application/json' } });
          if (!response.ok) return { status: response.status };
          const statuses = await response.json();
          if (!Array.isArray(statuses) || statuses.length > 40) return { status: 0 };
          const account = a => a && ({ id: a.id, acct: a.acct, display_name: a.display_name, verified: a.verified });
          const items = statuses.map(x => ({
            id: x.id, created_at: x.created_at, content: x.content, url: x.url, uri: x.uri,
            language: x.language, spoiler_text: x.spoiler_text, edited_at: x.edited_at, version: x.version,
            account: account(x.account), media_attachments: x.media_attachments,
            reblog: x.reblog && { id: x.reblog.id, url: x.reblog.url, content: x.reblog.content, account: account(x.reblog.account), media_attachments: x.reblog.media_attachments },
            quote: x.quote && { id: x.quote.id }, replies_count: x.replies_count,
            reblogs_count: x.reblogs_count, favourites_count: x.favourites_count
          }));
          return { status: response.status, items };
        }, { arg: target });
        if (!v || v.status !== 200 || !Array.isArray(v.items)) answer = { ok: false, code: 'unavailable', upstreamStatus: v?.status ?? null };
        else answer = { ok: true, url: target.apiUrl, items: v.items };
      } else if (target.kind === 'linux-list') {
        let v = await t.evaluate(s => new Promise(resolve => {
          const collect = () => Array.from(document.querySelectorAll(s.selector)).slice(0, 50).flatMap(row => {
            const link = row.querySelector('a.title');
            const id = row.getAttribute('data-topic-id');
            if (!link || !id || !/^\\d+$/.test(id)) return [];
            const url = new URL(link.getAttribute('href'), location.origin);
            const title = (link.innerText || link.textContent || '').trim().slice(0, 2000);
            if (url.origin !== 'https://linux.do' || !/^\\/t\\/topic\\/\\d+$/.test(url.pathname) || !title) return [];
            const label = row.querySelector('.age')?.getAttribute('title') || '';
            const chinese = /^创建日期[：:]\\s*(\\d{4})\\s*年\\s*(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*日\\s*(\\d{1,2}):(\\d{2})/.exec(label);
            const english = /^Created:\\s*([^\\n]+)/.exec(label)?.[1];
            const date = chinese ? new Date(+chinese[1], +chinese[2] - 1, +chinese[3], +chinese[4], +chinese[5])
              : english && /^[A-Za-z]{3} \\d{1,2}, \\d{4} \\d{1,2}:\\d{2} [ap]m$/i.test(english) ? new Date(english) : null;
            return [{ id, title, url: url.href, publishedAt: date && Number.isFinite(date.getTime()) ? date.toISOString() : null }];
          });
          const first = collect();
          if (first.length) return resolve({ url: location.href, items: first });
          const observer = new MutationObserver(() => {
            const items = collect();
            if (items.length) { observer.disconnect(); clearTimeout(timer); resolve({ url: location.href, items }); }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
          const timer = setTimeout(() => { observer.disconnect(); resolve({ url: location.href, items: [] }); }, 8000);
        }), { arg: target });
        if (!v || v.url !== target.url || !v.items?.length) answer = { ok: false, code: 'no_content' };
        else answer = { ok: true, url: v.url, items: v.items };
      } else {
        let v = await t.evaluate(s => new Promise(resolve => {
          const collect = () => {
            const el = document.querySelector(s.selector);
            if (!el) return null;
            const copy = el.cloneNode(true);
            if (s.remove) for (const node of copy.querySelectorAll(s.remove)) node.remove();
            const text = (copy.innerText || copy.textContent || '').trim();
            const date = (document.querySelector(s.date)?.innerText || '').slice(0, 2000).match(/20\\d{2}-\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}(?::\\d{2})?/);
            return text ? { url: location.href, html: copy.outerHTML, hasText: true, date: date?.[0] ?? null } : null;
          };
          const first = collect();
          if (first) return resolve(first);
          const observer = new MutationObserver(() => {
            const body = collect();
            if (body) { observer.disconnect(); clearTimeout(timer); resolve(body); }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
          const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, 8000);
        }), { arg: target });
        if (!v || v.url !== target.url || !v.hasText) answer = { ok: false, code: 'no_content' };
        else if (v.html.length > ${bodyLimit}) answer = { ok: false, code: 'too_large' };
        else answer = { ok: true, url: v.url, html: v.html, date: v.date };
      }
    } catch (e) { answer = { ok: false, code: 'unavailable', reason: String((e && e.message) || e).slice(0, 200) }; }
    finally { await t.close(); }
    answer`;
}

function readPage(target, signal) {
  return new Promise((resolve) => {
    const child = spawn(launcher, ['stdio'], { stdio: ['pipe', 'pipe', 'ignore'], env: { HOME: os.homedir(), PATH: process.env.PATH || '/usr/bin:/bin', XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '', LANG: process.env.LANG || 'C.UTF-8' } });
    let pending = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      child.kill();
      resolve(value);
    };
    const abort = () => finish({ ok: false, code: 'unavailable' });
    const timer = setTimeout(abort, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', abort);
    child.on('exit', () => finish({ ok: false, code: 'unavailable' }));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      pending += chunk;
      if (pending.length > responseLimit * 2) return abort();
      let end;
      while ((end = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        let message;
        try { message = JSON.parse(line); } catch { return abort(); }
        if (message.id === 1 && message.result) {
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'js', arguments: { code: browserScript(target), timeoutMs: 25000, maxChars: responseLimit } } }) + '\n');
        } else if (message.id === 2) {
          try {
            const text = message.result?.content?.find((x) => x.type === 'text')?.text ?? '';
            if (message.error || message.result?.isError) return finish({ ok: false, code: 'unavailable', reason: String(text || message.error?.message || '').slice(0, 200) });
            const result = JSON.parse(text);
            if (!result.ok || !result.value || typeof result.value !== 'object') return finish({ ok: false, code: 'unavailable', reason: 'the reader returned no value' });
            finish(result.value);
          } catch { abort(); }
        } else if (message.error) return abort();
      }
    });
    child.stdin.on('error', abort);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'tradinghot-browser-reader', version: '1' } } }) + '\n');
  });
}

function send(socket, result) {
  if (!socket.destroyed) socket.end(JSON.stringify(result) + '\n');
}
function drain() {
  while (active < maxActive && waiting.length) {
    const job = waiting.shift();
    if (job.socket.destroyed) continue;
    active++;
    const controller = new AbortController();
    job.socket.once('close', () => controller.abort());
    readPage(job.target, controller.signal).then(result => send(job.socket, result)).finally(() => { active--; drain(); });
  }
}
async function prepareSocket() {
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  const directory = await lstat(path.dirname(socketPath));
  if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077) !== 0) {
    throw new Error('bridge socket directory must be private and owned by this user');
  }
  try {
    const st = await lstat(socketPath);
    if (!st.isSocket() || st.uid !== process.getuid()) throw new Error('socket path is not an owned socket');
    const occupied = await new Promise(resolve => {
      const s = net.createConnection(socketPath);
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
    });
    if (occupied) throw new Error('bridge is already running');
    await unlink(socketPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await prepareSocket();
const server = net.createServer(socket => {
  let buffer = '';
  let received = false;
  socket.setTimeout(timeoutMs, () => socket.destroy());
  socket.setEncoding('utf8');
  socket.on('error', () => {});
  socket.on('data', chunk => {
    if (received) return;
    buffer += chunk;
    if (buffer.length > requestLimit) { received = true; return send(socket, { ok: false, code: 'invalid' }); }
    const end = buffer.indexOf('\n');
    if (end < 0) return;
    received = true;
    let request;
    try { request = JSON.parse(buffer.slice(0, end)); } catch { return send(socket, { ok: false, code: 'invalid' }); }
    const target = accepted(request);
    if (!target) return send(socket, { ok: false, code: 'invalid' });
    if (waiting.length >= maxQueued) return send(socket, { ok: false, code: 'busy' });
    waiting.push({ socket, target });
    drain();
  });
});
server.listen(socketPath, async () => {
  await chmod(socketPath, 0o600);
  console.log('BrowserMCP read-only bridge ready');
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
