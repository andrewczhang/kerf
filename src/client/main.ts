import './style.css';
import { Store } from './store';
import { Sync } from './sync';
import { Viewport } from './viewport';
import { Presence } from './presence';
import { Renderer } from './renderer';
import { Select } from './tools/select';
import { Shape } from './tools/shape';
import { TextEditor, TextTool } from './tools/text';
import { isTextNode } from '../shared/doc';
import { hit } from './geometry';
import { registry, type Context, type Tool } from './tools/tool';
import { toolbar } from './ui/toolbar';
import { inspector } from './ui/inspector';
import { people } from './ui/people';
if (location.pathname === '/')
    location.replace('/f/' + crypto.randomUUID().slice(0, 12));
const file = location.pathname.split('/')[2] || 'untitled';
document.querySelector('#app')!.innerHTML = '<header></header><main><div class="canvas-wrap"><canvas aria-label="Design canvas" tabindex="0"></canvas></div><aside></aside></main><footer><span id="file-id"></span><span id="connection">Connecting</span><div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-value" aria-label="Reset zoom">100%</button><button id="zoom-in" aria-label="Zoom in">+</button></div></footer>';
document.querySelector('#file-id')!.textContent = 'File / ' + file;
const canvas = document.querySelector('canvas')!, store = new Store();
let renderer: Renderer;
let textEditor: TextEditor;
const viewport = new Viewport(() => { renderer?.invalidate(); textEditor?.update(); document.querySelector('#zoom-value')!.textContent = Math.round(viewport.zoom * 100) + '%'; presence?.update(); });
const sync = new Sync(store, file);
const presence = new Presence(sync, viewport, store.selection);
const ctx: Context = { store, viewport, invalidate: () => renderer?.invalidate() };
textEditor = new TextEditor(ctx, canvas);
renderer = new Renderer(canvas, ctx, sync);
store.addEventListener('change', () => { renderer.invalidate(); presence.update(); });
sync.addEventListener('change', renderer.invalidate);
let active: Tool;
let space = false;
let pan: {
    x: number;
    y: number;
    vx: number;
    vy: number;
} | undefined;
let pointer: PointerEvent | undefined;
let queued = false;
function choose(id: string) { textEditor.close(); active = registry.get(id) ?? registry.get('select')!; canvas.style.cursor = active.cursor; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tool === id)); }
registry.set('select', new Select(ctx));
for (const type of ['rect', 'ellipse', 'frame'] as const)
    registry.set(type, new Shape(ctx, type, () => choose('select')));
registry.set('text', new TextTool(ctx, (node, creating) => { choose('select'); textEditor.open(node, creating); }));
registry.set('hand', { id: 'hand', cursor: 'grab', onPointerDown() { }, onPointerMove() { }, onPointerUp() { } });
toolbar(document.querySelector('header')!, choose);
choose('select');
inspector(document.querySelector('aside')!, store);
people(document.querySelector('#people')!, sync, viewport);
const local = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
canvas.ondblclick = e => {
    if (active.id !== 'select') return;
    const node = hit(store.doc, viewport.world(local(e)));
    if (isTextNode(node))
        textEditor.open(node);
};
function move(e: PointerEvent) { const p = local(e); if (pan) {
    viewport.x = pan.vx + p.x - pan.x;
    viewport.y = pan.vy + p.y - pan.y;
    viewport.changed();
}
else
    active.onPointerMove(viewport.world(p), e); presence.update(viewport.world(p)); }
canvas.onpointerdown = e => { if (e.button !== 0 && e.button !== 1)
    return; canvas.focus(); canvas.setPointerCapture(e.pointerId); const p = local(e); if (space || e.button === 1 || active.id === 'hand') {
    pan = { ...p, vx: viewport.x, vy: viewport.y };
    canvas.style.cursor = 'grabbing';
}
else
    active.onPointerDown(viewport.world(p), e); };
canvas.onpointermove = e => { pointer = e; if (!queued) {
    queued = true;
    requestAnimationFrame(() => { queued = false; if (pointer) {
        move(pointer);
        pointer = undefined;
    } });
} };
canvas.onpointerup = e => { if (pointer) {
    move(pointer);
    pointer = undefined;
} if (!pan)
    active.onPointerUp(viewport.world(local(e)), e); pan = undefined; canvas.style.cursor = active.cursor; presence.update(); };
canvas.onpointerleave = () => presence.update(null);
canvas.parentElement!.addEventListener('wheel', e => { e.preventDefault(); const p = local(e); if (e.ctrlKey || e.metaKey || !e.deltaX && Math.abs(e.deltaY) >= 50)
    viewport.zoomAt(p, Math.exp(-e.deltaY * .002));
else {
    viewport.x -= e.deltaX;
    viewport.y -= e.deltaY;
    viewport.changed();
} }, { passive: false });
window.addEventListener('keydown', e => { if ((e.target as HTMLElement).matches('input,textarea,select'))
    return; if (e.code === 'Space') {
    e.preventDefault();
    space = true;
    canvas.style.cursor = 'grab';
    return;
} if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    store.history(e.shiftKey);
    return;
} if (e.key === 'Enter' && e.target === canvas && active.id === 'select' && store.selection.size === 1) {
    const node = store.doc.get([...store.selection][0]);
    if (isTextNode(node)) {
        e.preventDefault();
        textEditor.open(node);
        return;
    }
} if (e.key === 'Escape') {
    store.selection.clear();
    store.changed();
    choose('select');
} const keys: Record<string, string> = { v: 'select', r: 'rect', o: 'ellipse', f: 'frame', t: 'text', h: 'hand' }; if (!e.ctrlKey && !e.metaKey && keys[e.key.toLowerCase()])
    choose(keys[e.key.toLowerCase()]);
else
    active.onKey?.(e); });
window.addEventListener('keyup', e => { if (e.code === 'Space') {
    space = false;
    canvas.style.cursor = active.cursor;
} });
document.querySelector('#zoom-in')!.addEventListener('click', () => viewport.zoomAt({ x: renderer.width / 2, y: renderer.height / 2 }, 1.25));
document.querySelector('#zoom-out')!.addEventListener('click', () => viewport.zoomAt({ x: renderer.width / 2, y: renderer.height / 2 }, .8));
document.querySelector('#zoom-value')!.addEventListener('click', () => viewport.zoomAt({ x: renderer.width / 2, y: renderer.height / 2 }, 1 / viewport.zoom));
