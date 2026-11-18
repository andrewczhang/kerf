import type { Point } from '../shared/geometry';
import { hit, aabb as world } from './geometry';
import { distancesTo } from '../shared/snap';
import { selectionBox } from './snapping';
import type { Context } from './tools/tool';
export function installGuides(canvas: HTMLCanvasElement, ctx: Context, file: string, isPanning = () => false) {
    const read = (key: string, fallback: unknown) => { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } };
    const state = ctx.snap = { guides: [], measure: [], rulers: read('kerf:rulers', true) as boolean, grid: read('kerf:grid', false) as boolean, lines: [] } as NonNullable<Context['snap']>;
    const stored = read('kerf:guides:' + file, []);
    if (Array.isArray(stored)) state.lines = stored.filter(l => l && (l.axis === 'x' || l.axis === 'y') && Number.isFinite(l.position));
    const button = document.createElement('button'); button.textContent = 'Snap to grid'; button.title = "Snap to grid (Ctrl/Cmd+')";
    document.querySelector('footer')!.insertBefore(button, document.querySelector('.zoom-controls'));
    const update = () => { button.setAttribute('aria-pressed', String(state.grid)); button.style.color = state.grid ? '#ff4f00' : ''; ctx.invalidate(); };
    const toggle = () => { state.grid = !state.grid; localStorage.setItem('kerf:grid', JSON.stringify(state.grid)); update(); };
    button.onclick = toggle; update();
    window.addEventListener('keydown', e => { if ((e.target as HTMLElement).matches('input,textarea')) return;
        if (e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); e.stopImmediatePropagation(); state.rulers = !state.rulers; localStorage.setItem('kerf:rulers', JSON.stringify(state.rulers)); ctx.invalidate(); }
        if ((e.ctrlKey || e.metaKey) && e.key === "'") { e.preventDefault(); e.stopImmediatePropagation(); toggle(); }
    }, true);
    const local = (e: PointerEvent): Point => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let dragging = -1;
    canvas.addEventListener('pointerdown', e => {
        if (e.button !== 0 || isPanning()) return;
        const p = local(e), w = ctx.viewport.world(p);
        if (state.rulers && (p.y < 20 || p.x < 20)) {
            state.lines.push({ axis: p.y < 20 ? 'y' : 'x', position: p.y < 20 ? w.y : w.x }); dragging = state.lines.length - 1;
        } else dragging = state.lines.findIndex(l => Math.abs((l.axis === 'x' ? p.x - ctx.viewport.x : p.y - ctx.viewport.y) - l.position * ctx.viewport.zoom) < 4);
        if (dragging >= 0) { e.stopImmediatePropagation(); canvas.setPointerCapture(e.pointerId); ctx.invalidate(); }
    }, true);
    canvas.addEventListener('pointermove', e => {
        if (dragging >= 0) { e.stopImmediatePropagation(); const p = ctx.viewport.world(local(e)), l = state.lines[dragging]; l.position = Math.round(p[l.axis]); ctx.invalidate(); return; }
        if (e.buttons) return;
        const box = selectionBox(ctx);
        state.measure = [];
        if (e.altKey && box) {
            let n = hit(ctx.store.doc, ctx.viewport.world(local(e)));
            if (n && ctx.store.selection.has(n.id)) n = undefined;
            if (!n) { const first = ctx.store.doc.get([...ctx.store.selection][0]); n = first?.parent ? ctx.store.doc.get(first.parent) : undefined; }
            if (n) state.measure = distancesTo(box, world(ctx.store.doc, n));
        }
        ctx.invalidate();
    }, true);
    canvas.addEventListener('pointerup', e => {
        if (dragging < 0) return;
        e.stopImmediatePropagation(); const p = local(e);
        if (state.rulers && (p.x < 20 || p.y < 20)) state.lines.splice(dragging, 1);
        dragging = -1; localStorage.setItem('kerf:guides:' + file, JSON.stringify(state.lines)); ctx.invalidate();
    }, true);
    window.addEventListener('keyup', e => { if (e.key === 'Alt') { state.measure = []; ctx.invalidate(); } });
}
export function drawGuides(c: CanvasRenderingContext2D, ctx: Context, width: number, height: number) {
    const s = ctx.snap; if (!s) return;
    const v = ctx.viewport, box = selectionBox(ctx);
    c.save(); c.font = '10px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    const line = (x: number, y: number, x2: number, y2: number) => { c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke(); };
    const label = (text: string, x: number, y: number) => { const w = c.measureText(text).width + 8; c.fillStyle = '#ff4f00'; c.fillRect(x - w / 2, y - 8, w, 16); c.fillStyle = '#fff'; c.fillText(text, x, y); };
    c.strokeStyle = '#ff4f00'; c.lineWidth = 1;
    for (const l of s.lines) { const p = l.position * v.zoom + (l.axis === 'x' ? v.x : v.y); if (l.axis === 'x') line(p, 0, p, height); else line(0, p, width, p); }
    for (const g of s.guides) { const p = g.position * v.zoom + (g.axis === 'x' ? v.x : v.y), a = g.start * v.zoom + (g.axis === 'x' ? v.y : v.x), b = g.end * v.zoom + (g.axis === 'x' ? v.y : v.x); if (g.axis === 'x') line(p, a, p, b); else line(a, p, b, p); }
    for (const d of s.measure) { const a = v.screen({ x: d.x1, y: d.y1 }), b = v.screen({ x: d.x2, y: d.y2 }); line(a.x, a.y, b.x, b.y); if (a.y === b.y) { line(a.x, a.y - 4, a.x, a.y + 4); line(b.x, b.y - 4, b.x, b.y + 4); } else { line(a.x - 4, a.y, a.x + 4, a.y); line(b.x - 4, b.y, b.x + 4, b.y); } label(String(Math.round(d.value)), (a.x + b.x) / 2, (a.y + b.y) / 2); }
    if (box) { const p = v.screen({ x: box.x + box.w / 2, y: box.y + box.h }); label(`${Math.round(box.w)} × ${Math.round(box.h)}`, p.x, p.y + 20); }
    if (s.rulers) {
        c.fillStyle = '#fbfbf9'; c.fillRect(0, 0, width, 20); c.fillRect(0, 0, 20, height); c.strokeStyle = '#d6d4ce'; line(20, 20, width, 20); line(20, 20, 20, height);
        const raw = 70 / v.zoom, power = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].find(n => n * power >= raw)! * power;
        for (const axis of ['x', 'y'] as const) {
            const offset = v[axis], extent = axis === 'x' ? width : height;
            for (let n = Math.ceil((20 - offset) / v.zoom / (step / 5)) * step / 5; n * v.zoom + offset < extent; n += step / 5) {
                const p = n * v.zoom + offset, major = Math.abs(n / step - Math.round(n / step)) < .001;
                c.strokeStyle = '#d6d4ce'; c.fillStyle = '#77766f';
                if (axis === 'x') { line(p, major ? 13 : 17, p, 20); if (major) c.fillText(String(Math.round(n)), p, 7); }
                else { line(major ? 13 : 17, p, 20, p); if (major) { c.save(); c.translate(7, p); c.rotate(-Math.PI / 2); c.fillText(String(Math.round(n)), 0, 0); c.restore(); } }
            }
            if (box) { const start = box[axis], end = start + box[axis === 'x' ? 'w' : 'h'], a = start * v.zoom + offset, b = end * v.zoom + offset; c.fillStyle = '#ff4f0030'; if (axis === 'x') c.fillRect(a, 0, b - a, 20); else c.fillRect(0, a, 20, b - a); c.fillStyle = '#ff4f00'; if (axis === 'x') { c.fillText(String(Math.round(start)), a, 7); c.fillText(String(Math.round(end)), b, 7); } else { c.save(); c.translate(7, a); c.rotate(-Math.PI / 2); c.fillText(String(Math.round(start)), 0, 0); c.restore(); c.save(); c.translate(7, b); c.rotate(-Math.PI / 2); c.fillText(String(Math.round(end)), 0, 0); c.restore(); } }
        }
        c.fillStyle = '#fbfbf9'; c.fillRect(0, 0, 20, 20);
    }
    c.restore();
}
export function drawSnapGrid(c: CanvasRenderingContext2D, ctx: Context, width: number, height: number) {
    const v = ctx.viewport, step = 8 * v.zoom; if (!ctx.snap?.grid || step < 6) return;
    c.save(); c.strokeStyle = '#d6d4ce'; c.lineWidth = .5; c.beginPath();
    for (let x = ((v.x % step) + step) % step; x < width; x += step) { c.moveTo(x, 0); c.lineTo(x, height); }
    for (let y = ((v.y % step) + step) % step; y < height; y += step) { c.moveTo(0, y); c.lineTo(width, y); }
    c.stroke(); c.restore();
}
