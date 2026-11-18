import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const count = Number(option('layers', '512'));
assert(Number.isInteger(count) && count >= 32, '--layers must be an integer >= 32');
const base = process.env.KERF_URL || 'http://127.0.0.1:8787';
const output = option('out', `stress-results/${Date.now()}-${count}`);
const endpoint = option('cdp', 'http://localhost:29229');
const file = 'browser-stress-' + randomUUID();
await mkdir(output, { recursive: true });

async function connection(url) {
    const ws = new WebSocket(url), pending = new Map(), listeners = new Map(); let seq = 0;
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.on('message', raw => {
        const m = JSON.parse(raw);
        if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result); }
        else for (const fn of listeners.get(m.method) ?? []) fn(m.params);
    });
    return {
        send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); },
        on(method, fn) { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); },
        close() { ws.close(); },
    };
}

async function seed() {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + `/f/${file}/ws`);
    const waiting = new Map();
    const ready = new Promise((resolve, reject) => {
        ws.on('error', reject);
        ws.on('message', raw => { const m = JSON.parse(raw); if (m.type === 'init') resolve(); if (m.type === 'ack') waiting.get(m.seq)?.(); });
    });
    try {
        await ready;
        const nodes = [];
        for (let i = 0; i < count; i++) {
            const group = Math.floor((i - 1) / 12), slot = (i - 1) % 12;
            const type = i === 0 ? 'rect' : slot === 0 ? 'frame' : i % 4 === 0 ? 'text' : i % 3 === 0 ? 'ellipse' : 'rect';
            const frame = i > 0 && slot === 0;
            const node = { id: `layer-${i}`, type, parent: i === 0 || frame ? null : `layer-${1 + group * 12}`, index: String(i).padStart(6, '0'), name: i === 0 ? 'Drag target' : `${type} ${i}`, x: i === 0 ? 40 : frame ? 320 + group % 6 * 460 : 20 + slot % 3 * 120, y: i === 0 ? 40 : frame ? Math.floor(group / 6) * 360 : 30 + Math.floor(slot / 3) * 65, w: frame ? 420 : type === 'text' ? 110 : 80, h: frame ? 300 : 40, fill: frame ? '#ffffff' : type === 'text' ? '#272822' : i % 2 ? '#ff4f00' : '#8faabb', stroke: null, strokeWidth: 1, radius: 4, opacity: 1 };
            if (type === 'text') Object.assign(node, { text: `Layer ${i} design\nSome wrapped copy`, fontFamily: 'sans', fontSize: 14, fontWeight: 400, textAlign: 'left', textWidth: 'fixed' });
            if (frame && group < 4) Object.assign(node, { layout: 'vertical', gap: 8, padLeft: 16, padTop: 16 });
            nodes.push(node);
        }
        for (let i = 0, seq = 0; i < nodes.length; i += 100) {
            const id = ++seq;
            await new Promise(resolve => { waiting.set(id, resolve); ws.send(JSON.stringify({ type: 'ops', seq: id, ops: nodes.slice(i, i + 100).map(node => ({ t: 'create', node })) })); });
        }
    } finally { ws.terminate(); }
}

const instrumentation = `(() => {
    const now = () => performance.timeOrigin + performance.now();
    const data = window.__stress = { init: false, moves: [], sent: [], acks: [], received: [], frames: [], recording: false };
    window.addEventListener('pointermove', e => { if (e.buttons === 1) { data.lastMove = { at: performance.timeOrigin + e.timeStamp, handled: now(), x: e.clientX, y: e.clientY }; data.moves.push(data.lastMove); } }, true);
    const Native = WebSocket;
    window.WebSocket = class extends Native {
        constructor(...args) { super(...args); this.addEventListener('message', e => {
            const m = JSON.parse(e.data), at = now();
            if (m.type === 'init') data.init = true;
            if (m.type === 'ack') data.acks.push({ seq: m.seq, at });
            if (m.type === 'ops') requestAnimationFrame(() => data.received.push({ ops: m.ops, at, painted: now() }));
        }); }
        send(raw) { const m = JSON.parse(raw); if (m.type === 'ops') data.sent.push({ seq: m.seq, ops: m.ops, at: now(), move: data.lastMove }); return super.send(raw); }
    };
    let previous;
    function frame(at) { if (data.recording && previous !== undefined) data.frames.push(at - previous); previous = data.recording ? at : undefined; requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
})();`;

const browser = await connection((await (await fetch(endpoint + '/json/version')).json()).webSocketDebuggerUrl);
const contexts = [], pages = [];
async function page() {
    const { browserContextId } = await browser.send('Target.createBrowserContext'); contexts.push(browserContextId);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId, newWindow: true, width: 1440, height: 1000 });
    const targets = await (await fetch(endpoint + '/json/list')).json();
    const cdp = await connection(targets.find(t => t.id === targetId).webSocketDebuggerUrl); pages.push(cdp);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: instrumentation });
    await cdp.send('Page.navigate', { url: `${base}/f/${file}` });
    const evaluate = async expression => { const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    for (let i = 0; i < 600; i++) { if (await evaluate('!!window.__stress?.init && document.querySelector("#connection")?.textContent === "Live"')) break; if (i === 599) throw Error('Editor init timed out'); await delay(100); }
    return { cdp, evaluate };
}
function stats(values) { assert(values.length, 'No samples'); const v = values.toSorted((a, b) => a - b); return { samples: v.length, p50: +v[Math.ceil(v.length * .5) - 1].toFixed(2), p95: +v[Math.ceil(v.length * .95) - 1].toFixed(2), max: +v.at(-1).toFixed(2) }; }
async function profile(page, name, fn) {
    await page.cdp.send('Profiler.enable'); await page.cdp.send('Profiler.start');
    await fn();
    const { profile } = await page.cdp.send('Profiler.stop');
    await writeFile(`${output}/${name}.cpuprofile`, JSON.stringify(profile));
    const hits = new Map(), nodes = new Map(profile.nodes.map(n => [n.id, n]));
    for (let i = 0; i < (profile.samples ?? []).length; i++) { const n = nodes.get(profile.samples[i]); const key = `${n.callFrame.functionName || '(anonymous)'}:${n.callFrame.lineNumber + 1}`; hits.set(key, (hits.get(key) ?? 0) + profile.timeDeltas[i] / 1000); }
    return [...hits].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([fn, ms]) => ({ fn, selfMs: +ms.toFixed(1) }));
}
try {
    await seed();
    const a = await page(), b = await page();
    await delay(4000);
    const box = await a.evaluate('(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()');
    const wheel = (dx, dy, modifiers = 0) => a.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x + box.w / 2, y: box.y + box.h / 2, deltaX: dx, deltaY: dy, modifiers });
    await a.evaluate('window.__stress.recording = true');
    const panProfile = await profile(a, 'pan', async () => {
        const start = Date.now(); let i = 0;
        while (Date.now() - start < 3000) { const sign = Math.floor(i / 15) % 2 ? -1 : 1; await wheel(i % 3 === 0 ? 0 : sign * 12, sign * 8, i % 3 === 0 ? 2 : 0); i++; await delay(16); }
    });
    const frames = await a.evaluate('window.__stress.recording = false; window.__stress.frames');
    // Reverse the pan/zoom by reloading; the default viewport is deterministic.
    await a.cdp.send('Page.reload');
    for (let i = 0; i < 600; i++) { await delay(100); if (await a.evaluate('window.__stress?.init && document.querySelector("#connection")?.textContent === "Live"')) break; }
    await delay(4000);
    const x = box.x + 120 + 80, y = box.y + 100 + 60;
    const mouse = (type, px, py, buttons) => a.cdp.send('Input.dispatchMouseEvent', { type, x: px, y: py, button: type === 'mouseMoved' ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const dragProfile = await profile(a, 'drag', async () => {
        await mouse('mouseMoved', x, y, 0); await mouse('mousePressed', x, y, 1);
        for (let i = 1; i <= 60; i++) { await mouse('mouseMoved', x + i * 2, y + i, 1); await delay(16); }
        await mouse('mouseReleased', x + 120, y + 60, 0);
        await delay(2000);
    });
    const aa = await a.evaluate('window.__stress'), bb = await b.evaluate('window.__stress');
    const ack = [], remote = [], painted = [], send = [];
    for (const m of aa.sent) {
        const change = m.ops.find(o => o.t === 'set' && o.id === 'layer-0' && o.key === 'x');
        if (!change || !m.move) continue;
        const receipt = aa.acks.find(r => r.seq === m.seq), seen = bb.received.find(r => r.ops.some(o => o.t === 'set' && o.id === change.id && o.key === 'x' && o.value === change.value));
        if (receipt) ack.push(receipt.at - m.move.at);
        if (seen) { remote.push(seen.at - m.move.at); painted.push(seen.painted - m.move.at); }
        send.push(m.at - m.move.at);
    }
    assert(ack.length >= 10 && painted.length >= 10, `Too few drag samples: ack=${ack.length} B=${painted.length}`);
    const result = { layers: count, file, frameGaps: stats(frames), moveToSend: stats(send), moveToAck: stats(ack), moveToBReceive: stats(remote), moveToBFrame: stats(painted), panProfile, dragProfile };
    await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2));
    for (const [name, p] of [['a', a], ['b', b]]) { const shot = await p.cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(`${output}/${name}.png`, Buffer.from(shot.data, 'base64')); }
    console.log(JSON.stringify(result, null, 2));
    console.log('Evidence: ' + output);
} finally {
    for (const p of pages) p.close();
    for (const browserContextId of contexts) await browser.send('Target.disposeBrowserContext', { browserContextId });
    browser.close();
}
