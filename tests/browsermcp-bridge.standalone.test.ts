import "./standalone.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(path.join(os.tmpdir(), "browser-bridge-"));
const socketPath = path.join(dir, "bridge.sock");
const launcher = path.join(dir, "launcher.mjs");
writeFileSync(launcher, `#!/usr/bin/env node
import readline from 'node:readline';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
let q = [], status = 'loading', target = '', current = 'about:blank', reads = 0;
const el = {textContent:'真实短帖', outerHTML:'<div class="newstext">真实短帖</div>', cloneNode(){return this}, querySelectorAll(){return []}};
const row = {getAttribute(k){return k==='data-topic-id'?'42':null},querySelector(s){if(s==='a.title')return {textContent:'真实主题',getAttribute(){return '/t/topic/42'}};if(s==='.age')return {getAttribute(){return target.includes('/top')?'Created: Nov 14, 2026 7:18 am\\nLatest: Nov 14, 2026 7:26 am':'创建日期：2026 年 11月 14 日 07:18\\n最新：2026 年 11月 14 日 07:26'}};return null}};
const document = {documentElement:{},querySelector(s){if(s==='.newstext')return target.includes('789.html')||target.includes('888.html')&&reads++===0?null:el;return {innerText:'2026-11-14 06:08:05'}},querySelectorAll(s){return s==='tr.topic-list-item'?[row]:[]}};
const location = {get href(){return current},get origin(){return new URL(current).origin}};
class MutationObserver {constructor(callback){this.callback=callback}observe(){queueMicrotask(()=>this.callback())}disconnect(){}}
const fakeTimeout = (fn,ms) => ms===8000?(queueMicrotask(fn),0):setTimeout(fn,ms);
const fakeFetch = async url => ({ok:true,status:200,async json(){return [{id:'100',created_at:'2026-11-14T00:00:00Z',content:'<p>真实原文</p>',url:'https://truthsocial.com/@realDonaldTrump/posts/100',account:{acct:'realDonaldTrump'},media_attachments:[]}]}});
const tab = {id:'1',cdp:{async watch(){return {async read(){let entries=q.splice(0);return {entries}},async close(){}}},async send(method,params){if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main'}}};if(method==='Fetch.continueRequest'){if(target.includes('456.html'))q.push({params:{frameId:'main',requestId:'redirect',request:{url:'https://other.example/private'}}});else {current=target;status='complete'}}if(method==='Fetch.failRequest'){status='complete';current='https://other.example/private'}}},async evaluate(fn,opts){return fn(opts?opts.arg:undefined)},async close(){}};
const browser = {tabs:{async new(){return tab}},chrome:{async call(method,args){if(method==='tabs.update'){target=args[1].url;if(target.includes('999.html'))await Promise.withResolvers().promise;q.push({params:{frameId:'main',requestId:'initial',request:{url:target}}});return {id:1}}if(method==='tabs.get')return {status,url:current}}}};
readline.createInterface({input:process.stdin}).on('line',async line=>{let m=JSON.parse(line);if(m.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'test',version:'1'}}}));if(m.id===2){try{let code=m.params.arguments.code.replace(/answer\\s*$/, 'return answer');let value=await new AsyncFunction('browser','document','location','MutationObserver','setTimeout','fetch',code)(browser,document,location,MutationObserver,fakeTimeout,fakeFetch);console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{content:[{type:'text',text:JSON.stringify({ok:true,value})}]}}))}catch(e){console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{isError:true,content:[{type:'text',text:'failed'}]}}))}}});
`);
chmodSync(launcher, 0o700);
const bridge = spawn(process.execPath, [path.resolve("scripts/browsermcp-bridge.mjs")], {
  env: { ...process.env, BROWSERMCP_BRIDGE_SOCKET: socketPath, BROWSERMCP_LAUNCHER: launcher },
  stdio: ["ignore", "pipe", "pipe"],
});
await once(bridge.stdout!, "data");
after(async () => { bridge.kill(); await once(bridge, "exit"); rmSync(dir, { recursive: true, force: true }); });

function request(value: unknown) {
  const { promise, resolve, reject } = Promise.withResolvers<any>();
  const socket = net.createConnection(socketPath);
  let text = "";
  socket.setEncoding("utf8");
  socket.on("error", reject);
  socket.on("connect", () => socket.write(JSON.stringify(value) + "\n"));
  socket.on("data", chunk => { text += chunk; if (text.includes("\n")) resolve(JSON.parse(text)); });
  return { promise, socket };
}
const url = (id: string) => `https://guba.eastmoney.com/news,600392,${id}.html`;

test("only an approved forum post's confirmed body is returned", async () => {
  const good = await request({ source: "cn-eastmoney-guba", url: url("123") }).promise;
  assert.equal(good.ok, true);
  assert.equal(good.html, '<div class="newstext">真实短帖</div>');
  assert.equal(good.date, "2026-11-14 06:08:05");
  for (const bad of [
    { source: "cn-eastmoney-guba", url: "https://guba.eastmoney.com/account" },
    { source: "cn-eastmoney-guba", url: "https://example.com/news,600392,123.html" },
    { source: "cn-eastmoney-guba", url: url("123"), code: "document.cookie" },
  ]) assert.deepEqual(await request(bad).promise, { ok: false, code: "invalid" });
});

test("redirects and missing post bodies never become article content", async () => {
  assert.deepEqual(await request({ source: "cn-eastmoney-guba", url: url("456") }).promise, { ok: false, code: "no_content" });
  assert.deepEqual(await request({ source: "cn-eastmoney-guba", url: url("789") }).promise, { ok: false, code: "no_content" });
});

test("a forum body rendered after navigation is still captured", async () => {
  const result = await request({ source: "cn-eastmoney-guba", url: url("888") }).promise;
  assert.equal(result.ok, true);
  assert.equal(result.html, '<div class="newstext">真实短帖</div>');
});

test("the Linux DO bridge reads only the approved listing and its creation time", async () => {
  const listing = await request({ source: "newsnow-linuxdo-latest", url: "https://linux.do/latest?order=created" }).promise;
  assert.equal(listing.ok, true);
  assert.deepEqual(listing.items, [{ id: "42", title: "真实主题", url: "https://linux.do/t/topic/42", publishedAt: new Date(2026, 10, 14, 7, 18).toISOString() }]);
  const hot = await request({ source: "newsnow-linuxdo-hot", url: "https://linux.do/top?period=daily" }).promise;
  assert.equal(hot.items[0].publishedAt, new Date(2026, 10, 14, 7, 18).toISOString());
  assert.deepEqual(await request({ source: "newsnow-linuxdo-latest", url: "https://linux.do/latest?order=created&extra=1" }).promise, { ok: false, code: "invalid" });
});

test("Truth Social reads only the approved account and bounded pagination", async () => {
  const url = "https://truthsocial.com/api/v1/accounts/107780257626128497/statuses";
  const result = await request({ source: "truthsocial-donald-trump", url }).promise;
  assert.equal(result.ok, true);
  assert.equal(result.items[0].content, "<p>真实原文</p>");
  assert.equal((await request({ source: "truthsocial-donald-trump", url: `${url}?max_id=123` }).promise).ok, true);
  for (const bad of [`${url}?max_id=123&url=https://example.com`, `${url}?max_id=../private`, url.replace("107780257626128497", "1")]) {
    assert.deepEqual(await request({ source: "truthsocial-donald-trump", url: bad }).promise, { ok: false, code: "invalid" });
  }
});

test("overload is rejected without an unbounded browser queue", async () => {
  const jobs = Array.from({ length: 16 }, () => request({ source: "cn-eastmoney-guba", url: url("999") }));
  try {
    const first = await Promise.race(jobs.map(job => job.promise));
    assert.deepEqual(first, { ok: false, code: "busy" });
  } finally {
    for (const job of jobs) { job.socket.destroy(); job.promise.catch(() => {}); }
  }
});
