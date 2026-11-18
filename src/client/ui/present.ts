import { children, descendants } from '../../shared/doc';
import { contains, inverse, transform, type Point } from '../../shared/geometry';
import { aabb, hit, worldMatrix } from '../geometry';
import { drawNode } from '../draw';
import type { Store } from '../store';
export function present(store: Store) {
    const overlay = document.createElement('div'); overlay.className = 'present-overlay';
    overlay.innerHTML = '<canvas aria-label="Presentation"></canvas><div class="present-footer"><span></span><span>← → Navigate · Backspace Back</span><button>Exit · Esc</button></div>';
    document.body.append(overlay);
    const canvas = overlay.querySelector('canvas')!, c = canvas.getContext('2d')!, label = overlay.querySelector('span')!;
    const frames = () => children(store.doc, null).filter(n => n.type === 'frame');
    let selected = [...store.selection].map(id => store.doc.get(id)).find(n => n?.type === 'frame' && !n.parent);
    let id = selected?.id ?? frames()[0]?.id, history: string[] = [], zoom = 1, ox = 0, oy = 0, flash = false, timer = 0;
    function draw() {
        const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
        canvas.width = r.width * d; canvas.height = r.height * d; c.setTransform(d, 0, 0, d, 0, 0);
        let frame = id ? store.doc.get(id) : undefined;
        if (!frame) { frame = frames()[0]; id = frame?.id; }
        if (!frame) { label.textContent = 'No top-level frames'; return; }
        const box = aabb(store.doc, frame);
        zoom = Math.max(.01, Math.min((r.width - 100) / box.w, (r.height - 80) / box.h));
        ox = (r.width - box.w * zoom) / 2 - box.x * zoom; oy = (r.height - box.h * zoom) / 2 - box.y * zoom;
        c.translate(ox, oy); c.scale(zoom, zoom); drawNode(c, store.doc, frame, { zoom, labels: false });
        if (flash) for (const n of [frame, ...descendants(store.doc, frame.id)]) if (n.link) {
            c.save(); c.transform(...worldMatrix(store.doc, n)); c.fillStyle = '#ff4f0033'; c.fillRect(0, 0, n.w, n.h); c.strokeStyle = '#ff4f00'; c.lineWidth = 2 / zoom; c.strokeRect(0, 0, n.w, n.h); c.restore();
        }
        label.textContent = `${frame.name}  /  ${frames().findIndex(n => n.id === id) + 1} of ${frames().length}`;
    }
    function hotspot(e: MouseEvent) {
        const r = canvas.getBoundingClientRect(), p: Point = { x: (e.clientX - r.left - ox) / zoom, y: (e.clientY - r.top - oy) / zoom };
        const frame = id ? store.doc.get(id) : undefined;
        if (!frame || !contains({ x: 0, y: 0, w: frame.w, h: frame.h }, transform(inverse(worldMatrix(store.doc, frame)), p))) return;
        let n = hit(store.doc, p, undefined, frame.id) ?? frame;
        while (n) { if (n.link && frames().some(f => f.id === n.link)) return n.link; if (!n.parent) break; n = store.doc.get(n.parent)!; }
    }
    const navigate = (next: string) => { if (id) history.push(id); id = next; draw(); };
    canvas.onmousemove = e => canvas.style.cursor = hotspot(e) ? 'pointer' : 'default';
    canvas.onclick = e => { const next = hotspot(e); if (next) navigate(next); else { flash = true; draw(); clearTimeout(timer); timer = window.setTimeout(() => { flash = false; draw(); }, 700); } };
    function close() { overlay.remove(); observer.disconnect(); store.removeEventListener('change', draw); window.removeEventListener('keydown', key, true); clearTimeout(timer); }
    function key(e: KeyboardEvent) { e.preventDefault(); e.stopImmediatePropagation(); if (e.key === 'Escape') close(); else if (e.key === 'Backspace') { id = history.pop() ?? id; draw(); } else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { const list = frames(), i = list.findIndex(n => n.id === id), next = list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]; if (next) navigate(next.id); } }
    overlay.querySelector('button')!.onclick = close;
    window.addEventListener('keydown', key, true); store.addEventListener('change', draw);
    const observer = new ResizeObserver(draw); observer.observe(canvas); draw();
}
