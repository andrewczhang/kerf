import { inspectCSS, measurements } from '../../shared/inspect';
import { aabb, hit, world } from '../geometry';
import type { Renderer } from '../renderer';
import type { Context } from '../tools/tool';
import './inspect.css';

export function installInspect(canvas: HTMLCanvasElement, ctx: Context, renderer: Renderer, select: () => void) {
    let enabled = false, hovered: string | undefined;
    let space = false, panning = false;
    const { store, viewport } = ctx;
    const button = document.createElement('button');
    button.className = 'feature-button';
    button.textContent = 'Inspect';
    button.title = 'Inspect (Shift+D)';
    button.setAttribute('aria-pressed', 'false');
    document.querySelector('header')!.append(button);
    const aside = document.querySelector<HTMLElement>('.inspector')!;
    const panel = document.createElement('div');
    panel.className = 'inspect-panel';
    panel.innerHTML = '<div class="panel-heading">Inspect <span>CSS</span></div><section><p class="inspect-name"></p><button class="inspect-copy">Copy CSS</button><pre><code></code></pre><p class="inspect-status" role="status"></p></section>';
    aside.append(panel);
    const copy = panel.querySelector<HTMLButtonElement>('button')!;
    let css = '';
    const render = () => {
        if (!enabled) return;
        const node = store.selection.size === 1 ? store.doc.get([...store.selection][0]) : undefined;
        css = inspectCSS(node, node ? { ...node, ...world(store.doc, node) } : undefined);
        panel.querySelector('.inspect-name')!.textContent = node?.name ?? 'Select one layer to inspect';
        panel.querySelector('code')!.textContent = css;
        panel.querySelector('.inspect-status')!.textContent = '';
        copy.disabled = !css;
    };
    copy.onclick = async () => {
        try { await navigator.clipboard.writeText(css); panel.querySelector('.inspect-status')!.textContent = 'Copied'; }
        catch { panel.querySelector('.inspect-status')!.textContent = 'Could not copy. Select the CSS to copy manually.'; }
    };
    const toggle = () => {
        select();
        enabled = !enabled;
        hovered = undefined;
        aside.classList.toggle('is-inspecting', enabled);
        button.setAttribute('aria-pressed', String(enabled));
        canvas.style.cursor = 'default';
        render(); renderer.invalidate();
    };
    button.onclick = toggle;
    const commit = store.commit.bind(store);
    store.commit = (...args) => { if (!enabled) commit(...args); };
    const history = store.history.bind(store);
    store.history = (...args) => { if (!enabled) history(...args); };
    store.addEventListener('change', render);
    window.addEventListener('keydown', e => {
        if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
        if (enabled && (e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopImmediatePropagation(); return; }
        if ((e.target as HTMLElement).closest('button') || document.querySelector('.present-overlay')) return;
        if (e.code === 'Space') space = true;
        if (e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyD') { e.preventDefault(); e.stopImmediatePropagation(); toggle(); return; }
        const editingKey = ['Delete', 'Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
            || (e.ctrlKey || e.metaKey) && ['z', 'g', 'x', 'v', 'd'].includes(e.key.toLowerCase());
        if (enabled && editingKey) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener('keyup', e => { if (e.code === 'Space') space = false; }, true);
    window.addEventListener('blur', () => { space = false; panning = false; });
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'dblclick'] as const) canvas.addEventListener(type, e => {
        if (!enabled) return;
        if (type === 'pointerdown') panning = space || ctx.active?.id === 'hand' || e.button === 1;
        const panGesture = panning || space || ctx.active?.id === 'hand';
        if (type === 'pointerup') panning = false;
        if (panGesture) return;
        e.stopImmediatePropagation();
        const r = canvas.getBoundingClientRect();
        hovered = hit(store.pageDoc, viewport.world({ x: e.clientX - r.left, y: e.clientY - r.top }), 4 / viewport.zoom)?.id;
        if (type === 'pointerdown') {
            canvas.focus();
            store.selection.clear();
            if (hovered) store.selection.add(hovered);
            store.changed();
        }
        renderer.invalidate();
    }, true);
    canvas.addEventListener('pointerleave', () => { hovered = undefined; renderer.invalidate(); });
    renderer.inspectOverlay = c => {
        if (!enabled) return;
        const node = hovered && store.doc.get(hovered);
        if (!node) return;
        const b = aabb(store.doc, node), p = viewport.screen(b);
        c.save(); c.strokeStyle = '#d92d20'; c.fillStyle = '#d92d20'; c.lineWidth = 1; c.font = '12px monospace';
        const crisp = (n: number) => Math.round(n) + .5;
        c.strokeRect(crisp(p.x), crisp(p.y), Math.round(b.w * viewport.zoom), Math.round(b.h * viewport.zoom));
        const label = (text: string, x: number, y: number) => {
            const w = c.measureText(text).width;
            c.fillStyle = '#fbfbf9'; c.fillRect(Math.round(x - w / 2 - 3), Math.round(y - 12), w + 6, 16);
            c.fillStyle = '#d92d20'; c.fillText(text, Math.round(x - w / 2), Math.round(y));
        };
        const selected = store.selection.size === 1 && store.doc.get([...store.selection][0]);
        if (!selected) label(`${Math.round(b.w)} × ${Math.round(b.h)}`, p.x + b.w * viewport.zoom / 2, p.y - 8);
        else if (selected.id !== node.id) for (const m of measurements(aabb(store.doc, selected), b)) {
            const a = viewport.screen(m.from), z = viewport.screen(m.to), horizontal = a.y === z.y;
            c.beginPath(); c.moveTo(crisp(a.x), crisp(a.y)); c.lineTo(crisp(z.x), crisp(z.y));
            for (const q of [a, z]) { c.moveTo(crisp(q.x - (horizontal ? 0 : 4)), crisp(q.y - (horizontal ? 4 : 0))); c.lineTo(crisp(q.x + (horizontal ? 0 : 4)), crisp(q.y + (horizontal ? 4 : 0))); }
            c.stroke(); label(`${m.distance} px`, (a.x + z.x) / 2, (a.y + z.y) / 2 - 5);
        }
        c.restore();
    };
    return () => enabled;
}
