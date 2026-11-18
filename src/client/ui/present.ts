import { descendants, type Doc } from '../../shared/doc';
import { type Point } from '../../shared/geometry';
import { aabb, worldCorners } from '../geometry';
import { drawNode } from '../draw';
import type { Store } from '../store';
import { expand } from '../../shared/components';
import type { Sync } from '../sync';
import { commentPoint, commentSurface } from './comments';
import { hotspotAt, interactiveHotspots, presentationContains, presentationFrames, presentationHit, presentationSource } from './presentation';

export function present(store: Store, sync: Sync, options: { initial?: string; preview?: Doc | null; name?: string } = {}) {
    const source = presentationSource(store, options.preview ?? null, options.name ?? 'version');
    let resolved = expand(options.preview ? source.doc : store.doc);
    const doc = () => resolved;
    const overlay = document.createElement('div'); overlay.className = 'present-overlay';
    overlay.innerHTML = '<div class="present-stage"><canvas aria-label="Presentation"></canvas></div><div class="present-footer"><span></span><small></small><span>← → Navigate · Backspace Back</span><button class="present-comment" title="Comment (C)" aria-pressed="false">Comment · C</button><button class="present-exit">Exit · Esc</button></div>';
    document.body.append(overlay);
    const canvas = overlay.querySelector('canvas')!, stage = overlay.querySelector<HTMLElement>('.present-stage')!, c = canvas.getContext('2d')!, label = overlay.querySelector('span')!;
    overlay.querySelector('small')!.textContent = source.note;
    const frames = () => presentationFrames(doc());
    const selected = (options.initial ? [doc().get(options.initial)] : [...source.selection].map(id => doc().get(id))).find(n => n?.type === 'frame' && !n.parent && !n.hidden);
    let id = selected?.id ?? frames()[0]?.id, history: string[] = [], zoom = 1, ox = 0, oy = 0, flash = false, timer = 0, commenting = false;
    const frame = () => id ? doc().get(id) : undefined;
    const surface = commentSurface(sync, stage, doc, p => ({ x: p.x * zoom + ox, y: p.y * zoom + oy }), comment => {
        const current = frame(); if (!current) return false;
        const members = new Set([current.id, ...descendants(doc(), current.id).map(n => n.id)]);
        return (!comment.node || members.has(comment.node)) && presentationContains(doc(), current, commentPoint(doc(), comment));
    });
    function draw() {
        resolved = expand(options.preview ? source.doc : store.doc);
        const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
        canvas.width = r.width * d; canvas.height = r.height * d; c.setTransform(d, 0, 0, d, 0, 0);
        let current = frame();
        if (!current || current.hidden) { current = frames()[0]; id = current?.id; }
        if (!current) { label.textContent = 'No top-level frames'; surface.render(); return; }
        const box = aabb(doc(), current);
        zoom = Math.max(.01, Math.min((r.width - 100) / box.w, (r.height - 80) / box.h));
        ox = (r.width - box.w * zoom) / 2 - box.x * zoom; oy = (r.height - box.h * zoom) / 2 - box.y * zoom;
        c.translate(ox, oy); c.scale(zoom, zoom); drawNode(c, doc(), current, { zoom, scale: zoom * d, labels: false, invalidate: draw });
        if (flash) {
            const outline = (node: typeof current) => { c.beginPath(); worldCorners(doc(), node).forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); };
            c.save(); outline(current); c.clip();
            for (const n of interactiveHotspots(doc(), current)) {
                outline(n); c.fillStyle = '#ff4f0033'; c.fill(); c.strokeStyle = '#ff4f00'; c.lineWidth = 2 / zoom; c.stroke();
            }
            c.restore();
        }
        label.textContent = `${current.name}  /  ${frames().findIndex(n => n.id === id) + 1} of ${frames().length}`;
        surface.render();
    }
    const point = (e: MouseEvent): Point => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left - ox) / zoom, y: (e.clientY - r.top - oy) / zoom }; };
    const navigate = (next: string) => { surface.close(); if (id) history.push(id); id = next; draw(); };
    const commentButton = overlay.querySelector<HTMLButtonElement>('.present-comment')!;
    function toggleComments() { commenting = !commenting; commentButton.setAttribute('aria-pressed', String(commenting)); canvas.style.cursor = commenting ? 'crosshair' : 'default'; flash = false; draw(); }
    commentButton.onclick = toggleComments;
    canvas.onmousemove = e => { const current = frame(); canvas.style.cursor = commenting ? 'crosshair' : current && hotspotAt(doc(), current, point(e)) ? 'pointer' : 'default'; };
    canvas.onclick = e => {
        const current = frame(), p = point(e); if (!current || !presentationContains(doc(), current, p)) return;
        if (commenting) { surface.start(p, presentationHit(doc(), current, p)); return; }
        const next = hotspotAt(doc(), current, p);
        if (next) navigate(next); else { flash = true; draw(); clearTimeout(timer); timer = window.setTimeout(() => { flash = false; draw(); }, 700); }
    };
    function close() { surface.dispose(); overlay.remove(); observer.disconnect(); store.removeEventListener('change', draw); window.removeEventListener('keydown', key, true); clearTimeout(timer); }
    function key(e: KeyboardEvent) {
        if (e.key !== 'Escape' && (e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
        if (e.key === 'Tab') { e.stopPropagation(); return; }
        if (overlay.contains(e.target as Node) && (e.target as HTMLElement).closest('button') && ['Enter', ' '].includes(e.key)) { e.stopPropagation(); return; }
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.key === 'Escape') { if (surface.isOpen()) surface.close(); else if (commenting) toggleComments(); else close(); }
        else if (e.key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) toggleComments();
        else if (e.key === 'Backspace') { surface.close(); id = history.pop() ?? id; draw(); }
        else if (['ArrowLeft', 'ArrowRight'].includes(e.key)) { const list = frames(), i = list.findIndex(n => n.id === id), next = list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length]; if (next) navigate(next.id); }
    }
    overlay.querySelector<HTMLButtonElement>('.present-exit')!.onclick = close;
    window.addEventListener('keydown', key, true); store.addEventListener('change', draw);
    const observer = new ResizeObserver(draw); observer.observe(canvas); draw();
}
