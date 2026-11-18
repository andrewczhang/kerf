import './style.css';
import { Store } from './store';
import { addAutoLayout, isAutoLayout, wrapInAutoLayout } from './autolayout';
import { Sync } from './sync';
import { Viewport } from './viewport';
import { Presence } from './presence';
import { Renderer } from './renderer';
import { Select } from './tools/select';
import { Shape } from './tools/shape';
import { Pen } from './tools/pen';
import { TextEditor, TextTool } from './tools/text';
import { isTextNode } from '../shared/doc';
import { hit } from './geometry';
import { clearTextLayouts, measureTextNode } from './text-layout';
import { registry, type Context, type Tool } from './tools/tool';
import { toolbar } from './ui/toolbar';
import { inspector } from './ui/inspector';
import { installInspect } from './ui/inspect';
import { people } from './ui/people';
import { imageImport } from './image-import';
import { layers } from './ui/layers';
import { features } from './ui/features';
import { installGuides } from './guides';
import { downloadSelection } from './export';
if (location.pathname === '/')
    location.replace('/f/' + crypto.randomUUID().slice(0, 12));
const file = location.pathname.split('/')[2] || 'untitled';
document.querySelector('#app')!.innerHTML = '<header></header><main><aside class="layers"></aside><div class="canvas-wrap"><canvas aria-label="Design canvas" tabindex="0"></canvas></div><aside class="inspector"></aside></main><footer><span id="file-id"></span><span id="connection">Connecting</span><div class="zoom-controls"><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-value" aria-label="Reset zoom">100%</button><button id="zoom-in" aria-label="Zoom in">+</button></div></footer>';
document.querySelector('#file-id')!.textContent = 'File / ' + file;
const canvas = document.querySelector('canvas')!, store = new Store(measureTextNode);
const fontsChanged = () => {
    clearTextLayouts();
    if ([...store.doc.values()].some(isTextNode)) store.relayout();
};
void document.fonts.ready.then(fontsChanged);
document.fonts.addEventListener('loadingdone', fontsChanged);
let renderer: Renderer;
let textEditor: TextEditor;
const viewport = new Viewport(() => { renderer?.invalidate(); textEditor?.update(); document.querySelector('#zoom-value')!.textContent = Math.round(viewport.zoom * 100) + '%'; presence?.update(); });
const sync = new Sync(store, file);
const presence = new Presence(sync, viewport, store.selection);
const ctx: Context = { store, viewport, invalidate: () => renderer?.invalidate() };
installGuides(canvas, ctx, file, () => space || active?.id === 'hand');
textEditor = new TextEditor(ctx, canvas);
renderer = new Renderer(canvas, ctx, sync);
imageImport(canvas, ctx, file);
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
function choose(id: string) { if (textEditor.close() === false) return; active?.deactivate?.(); active = ctx.active = registry.get(id) ?? registry.get('select')!; active.activate?.(); canvas.style.cursor = active.cursor; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.tool === id)); }
registry.set('select', new Select(ctx));
for (const type of ['rect', 'ellipse', 'frame'] as const)
    registry.set(type, new Shape(ctx, type, () => choose('select')));
registry.set('text', new TextTool(ctx, (node, creating) => { if (isInspecting()) return; choose('select'); textEditor.open(node, creating); }));
registry.set('pen', new Pen(ctx, () => choose('select')));
registry.set('hand', { id: 'hand', cursor: 'grab', onPointerDown() { }, onPointerMove() { }, onPointerUp() { } });
toolbar(document.querySelector('header')!, choose);
choose('select');
inspector(document.querySelector('.inspector')!, store);
layers(document.querySelector('.layers')!, ctx);
people(document.querySelector('#people')!, sync, presence, canvas.parentElement!);
features(renderer, sync, ctx, choose);
const isInspecting = installInspect(canvas, ctx, renderer, () => choose('select'));
const local = (e: MouseEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
canvas.ondblclick = e => {
    if (isInspecting() || active.id !== 'select') return;
    const node = hit(store.doc, viewport.world(local(e)), 4 / viewport.zoom);
    if (isTextNode(node))
        textEditor.open(node);
    else if (node?.type === 'path') {
        store.selection.clear();
        store.selection.add(node.id);
        choose('pen');
        store.changed();
    }
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
    presence.stopFollowing();
    pan = { ...p, vx: viewport.x, vy: viewport.y };
    canvas.style.cursor = 'grabbing';
}
else {
    if (active.id === 'comment') e.preventDefault();
    active.onPointerDown(viewport.world(p), e);
} };
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
canvas.parentElement!.addEventListener('wheel', e => { if ((e.target as HTMLElement).closest('.comment-pop')) return; e.preventDefault(); presence.stopFollowing(); const p = local(e); if (e.ctrlKey || e.metaKey || !e.deltaX && Math.abs(e.deltaY) >= 50)
    viewport.zoomAt(p, Math.exp(-e.deltaY * .002));
else {
    viewport.x -= e.deltaX;
    viewport.y -= e.deltaY;
    viewport.changed();
} }, { passive: false });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && presence.stopFollowing())
    return; if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') || ctx.editingText)
    return; if (e.target === canvas && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { registry.get('select')!.onKey?.(e); return; } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { registry.get('select')!.onKey?.(e); return; } if (active.onKey?.(e))
    return; if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    void downloadSelection(store.doc, store.selection, 'png', 2).catch(() => alert('Export failed. Please try again.'));
    return;
} if (e.code === 'Space') {
    if ((e.target as HTMLElement).closest('#people button, .follow-banner button')) return;
    e.preventDefault();
    space = true;
    canvas.style.cursor = 'grab';
    return;
} if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    store.history(e.shiftKey);
    return;
} if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    const nodes = [...store.selection].flatMap(id => { const n = store.doc.get(id); return n ? [n] : []; });
    if (nodes.length === 1 && nodes[0].type === 'frame' && !isAutoLayout(nodes[0])) addAutoLayout(store, nodes[0]);
    else if (nodes.length) wrapInAutoLayout(store, nodes);
    return;
} if (!isInspecting() && e.key === 'Enter' && e.target === canvas && active.id === 'select' && store.selection.size === 1) {
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
} if (e.key === 'Enter' && active.id === 'select' && store.selection.size === 1 && store.doc.get([...store.selection][0])?.type === 'path')
    choose('pen'); const keys: Record<string, string> = { v: 'select', r: 'rect', o: 'ellipse', f: 'frame', t: 'text', h: 'hand', p: 'pen' }; if (!e.ctrlKey && !e.metaKey && keys[e.key.toLowerCase()])
    choose(keys[e.key.toLowerCase()]); });
window.addEventListener('keyup', e => { if (e.code === 'Space') {
    space = false;
    canvas.style.cursor = active.cursor;
} });
function zoomFromToolbar(factor: number) {
    presence.stopFollowing();
    viewport.zoomAt({ x: renderer.width / 2, y: renderer.height / 2 }, factor);
}
document.querySelector('#zoom-in')!.addEventListener('click', () => zoomFromToolbar(1.25));
document.querySelector('#zoom-out')!.addEventListener('click', () => zoomFromToolbar(.8));
document.querySelector('#zoom-value')!.addEventListener('click', () => zoomFromToolbar(1 / viewport.zoom));
