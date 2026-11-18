import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const count = Number(process.argv.find(a => a.startsWith('--layers='))?.split('=')[1] ?? 512);
assert(Number.isInteger(count) && count > 0, '--layers must be a positive integer');
const base = (process.env.KERF_URL || 'http://127.0.0.1:8787').replace(/^http/, 'ws').replace(/\/$/, '');
const file = 'stress-' + randomUUID();
const ws = new WebSocket(`${base}/f/${file}/ws?clientId=${randomUUID()}`);
const pending = new Map();
let seq = 0;
const init = new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('message', raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'init') resolve(msg);
        if (msg.type === 'ack') pending.get(msg.seq)?.();
    });
});
function send(ops) {
    const id = ++seq, start = performance.now();
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(Error(`Ack timeout: ${id}`)); }, 60000);
        pending.set(id, () => { clearTimeout(timeout); pending.delete(id); resolve(performance.now() - start); });
        ws.send(JSON.stringify({ type: 'ops', seq: id, ops }));
    });
}
try {
    let timeout;
    try { await Promise.race([init, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Init timeout')), 10000); })]); }
    finally { clearTimeout(timeout); }
    const nodes = Array.from({ length: count }, (_, i) => ({ id: `layer-${i}`, type: 'rect', parent: null, index: String(i).padStart(6, '0'), name: 'Rectangle', x: i % 32 * 110, y: Math.floor(i / 32) * 110, w: 100, h: 100, fill: '#ff4f00', stroke: null, strokeWidth: 1, radius: 0, opacity: 1 }));
    for (let i = 0; i < nodes.length; i += 100) await send(nodes.slice(i, i + 100).map(node => ({ t: 'create', node })));
    const samples = [];
    for (let i = 0; i < 60; i++) {
        samples.push(send(['x', 'y'].map(key => ({ t: 'set', id: nodes[0].id, key, value: i * 2 }))));
        await delay(16);
    }
    const times = (await Promise.all(samples)).sort((a, b) => a - b);
    console.log(`layers=${count} messages=60 interval=16ms p50=${times[29].toFixed(2)}ms p95=${times[56].toFixed(2)}ms max=${times[59].toFixed(2)}ms file=${file}`);
} finally {
    ws.terminate();
}
