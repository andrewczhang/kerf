import { inverse, transform, type Point } from '../../shared/geometry';
import { hit, worldMatrix } from '../geometry';
import type { Comment } from '../../shared/comments';
import type { Sync } from '../sync';
import type { Context } from '../tools/tool';
import { registry } from '../tools/tool';
import type { Doc, Node } from '../../shared/doc';
export function commentSurface(sync: Sync, wrap: HTMLElement, doc: () => Doc, screen: (p: Point) => Point, visible: (c: Comment) => boolean = () => true) {
    const pins = document.createElement('div'), pop = document.createElement('div');
    pop.className = 'comment-pop'; pop.hidden = true; wrap.append(pins, pop);
    let open: string | null = null, draft: { x: number; y: number; node?: string } | null = null, showResolved = false;
    const position = (c: { x: number; y: number; node?: string }) => screen(commentPoint(doc(), c));
    function close() { open = null; draft = null; pop.hidden = true; }
    function placePop(p: Point) {
        pop.style.maxHeight = Math.max(0, wrap.clientHeight - 16) + 'px';
        pop.style.maxWidth = Math.max(0, wrap.clientWidth - 16) + 'px';
        pop.style.left = Math.max(8, Math.min(p.x + 34, wrap.clientWidth - pop.offsetWidth - 8)) + 'px';
        pop.style.top = Math.max(8, Math.min(p.y, wrap.clientHeight - pop.offsetHeight - 8)) + 'px';
    }
    function render() {
        pins.replaceChildren();
        const roots = sync.comments.filter(c => c.thread === null);
        for (const [i, c] of roots.entries()) {
            if (c.resolved && !showResolved || !visible(c)) continue;
            const p = position(c), b = document.createElement('button'); b.className = 'comment-pin'; b.textContent = String(i + 1); b.style.background = c.color; b.style.left = p.x + 'px'; b.style.top = p.y + 'px'; b.title = c.text;
            b.onclick = () => { open = c.id; draft = null; thread(); }; pins.append(b);
        }
        const anchor = draft ?? roots.find(c => c.id === open);
        if (anchor && !pop.hidden) placePop(position(anchor));
    }
    function thread() {
        pop.replaceChildren(); pop.hidden = false;
        const root = sync.comments.find(c => c.id === open);
        if (!root && !draft || root && (!visible(root) || root.resolved && !showResolved)) { close(); return; }
        const head = document.createElement('h2'); head.textContent = draft ? 'New comment' : root?.resolved ? 'Resolved thread' : 'Comment thread'; pop.append(head);
        const replies = document.createElement('div'); replies.className = 'comment-replies'; pop.append(replies);
        if (root) for (const c of sync.comments.filter(c => c.id === root.id || c.thread === root.id)) {
            const article = document.createElement('article'), meta = document.createElement('small'), body = document.createElement('p');
            meta.textContent = `${c.author} · ${new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; body.textContent = c.text; article.append(meta, body); replies.append(article);
        }
        const input = document.createElement('textarea'); input.placeholder = draft ? 'Leave a comment…' : 'Reply…'; input.rows = 2; input.maxLength = 10000; input.setAttribute('aria-label', input.placeholder); pop.append(input);
        const status = document.createElement('div'); status.setAttribute('role', 'status'); pop.append(status);
        const actions = document.createElement('div'); actions.className = 'comment-actions'; pop.append(actions);
        const button = (text: string, fn: () => void) => { const b = document.createElement('button'); b.className = 'feature-button'; b.textContent = text; b.onclick = fn; actions.append(b); };
        const post = () => {
            if (!input.value.trim()) return;
            if (!sync.you) { status.textContent = 'Offline — reconnect to post. Your draft is kept.'; return; }
            const c: Comment = { id: crypto.randomUUID(), thread: root?.id ?? null, ...(draft ?? { x: root!.x, y: root!.y, node: root!.node }), author: sync.you.name, color: sync.you.color, text: input.value.trim(), at: Date.now() };
            if (!sync.send({ type: 'comment-add', comment: c })) { status.textContent = 'Offline — reconnect to post. Your draft is kept.'; return; }
            if (draft) { open = c.id; draft = null; } input.value = ''; status.textContent = '';
        };
        input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } };
        button('Post', post);
        if (root && sync.role === 'edit') { button(root.resolved ? 'Reopen' : 'Resolve', () => { sync.send({ type: 'comment-edit', id: root.id, resolved: !root.resolved }); close(); }); button('Delete', () => { sync.send({ type: 'comment-delete', id: root.id }); close(); }); }
        button('Close', close); render(); input.focus();
    }
    const refresh = () => { render(); if (!pop.hidden && !draft) { const value = pop.querySelector('textarea')?.value ?? ''; thread(); const input = pop.querySelector('textarea'); if (input) input.value = value; } };
    sync.addEventListener('comments-change', refresh);
    sync.addEventListener('change', render);
    return {
        render, close,
        isOpen: () => !pop.hidden,
        start(p: Point, n?: Node) { draft = commentAnchor(doc(), p, n); open = null; thread(); },
        resolved(value: boolean) { showResolved = value; render(); },
        dispose() { sync.removeEventListener('comments-change', refresh); sync.removeEventListener('change', render); pins.remove(); pop.remove(); }
    };
}
export function commentPoint(doc: Doc, c: { x: number; y: number; node?: string }): Point {
    const n = c.node && doc.get(c.node);
    return n ? transform(worldMatrix(doc, n), c) : { x: c.x, y: c.y };
}
export function commentAnchor(doc: Doc, p: Point, n?: Node) {
    const local = n ? transform(inverse(worldMatrix(doc, n)), p) : p;
    return { ...local, ...(n ? { node: n.id } : {}) };
}
export function comments(sync: Sync, ctx: Context, canvas: HTMLCanvasElement, choose: (id: string) => void) {
    const surface = commentSurface(sync, canvas.parentElement!, () => ctx.store.doc, p => ctx.viewport.screen(p));
    registry.set('comment', { id: 'comment', cursor: 'crosshair', onPointerDown(p) {
        surface.start(p, hit(ctx.store.doc, p));
    }, onPointerMove() {}, onPointerUp() {} });
    const b = document.createElement('button'); b.className = 'feature-button'; b.dataset.tool = 'comment'; b.title = 'Comment (C)'; b.textContent = 'Comment'; b.onclick = () => choose('comment');
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.onchange = () => surface.resolved(check.checked); label.append(check, ' Show resolved');
    document.querySelector('header')!.append(b, label);
    ctx.store.addEventListener('change', surface.render);
    const observer = new MutationObserver(surface.render); observer.observe(document.querySelector('#zoom-value')!, { childList: true });
    new ResizeObserver(surface.render).observe(canvas);
}
