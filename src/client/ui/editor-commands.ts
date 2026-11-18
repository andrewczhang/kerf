import { registry, type Context } from '../tools/tool';
import { downloadSelection, exportBounds, exportRoots } from '../export';
import { newFile } from '../recent-files';
import { installPalette, registerCommand } from './palette';
import type { Renderer } from '../renderer';
import { componentOps, detachOps, expand } from '../../shared/components';
import { sizeOf } from '../geometry';
export function editorCommands(ctx: Context, renderer: Renderer, choose: (id: string) => void, isInspecting = () => false) {
    const { store, viewport } = ctx;
    const add = (id: string, title: string, group: string, run: () => void | Promise<void>, shortcut?: string, enabled?: () => boolean) => {
        const available = () => (!(renderer.preview || isInspecting()) || !['Edit', 'Layers', 'Tools', 'Panels', 'Comments'].includes(group)) && (!enabled || enabled());
        return registerCommand({ id, title, group, run: () => { if (available()) return run(); }, shortcut, enabled: available });
    };
    const keys: Record<string, string> = { select: 'V', frame: 'F', rect: 'R', ellipse: 'O', text: 'T', pen: 'P', hand: 'H', comment: 'C' };
    add('undo', 'Undo', 'Edit', () => store.history(false), 'Ctrl/⌘ Z');
    add('redo', 'Redo', 'Edit', () => store.history(true), 'Ctrl/⌘ ⇧ Z');
    add('create-component', 'Create component', 'Layers', () => {
        const { ops, id } = componentOps.create(store.doc, [...store.selection], sizeOf);
        if (!ops.length) return;
        store.commit(ops); store.selection = new Set([id]); store.changed();
    }, 'Ctrl/⌘ Alt K', () => { try { return componentOps.create(store.doc, [...store.selection], sizeOf).ops.length > 0; } catch { return false; } });
    add('detach-instance', 'Detach instance', 'Layers', () => { store.commit(detachOps(store.doc, [...store.selection])); }, 'Ctrl/⌘ Alt B', () => [...store.selection].some(id => !!store.doc.get(id)?.instanceOf));
    for (const format of ['png', 'svg'] as const) add('export-' + format, 'Export selection ' + format.toUpperCase(), 'Export', () => downloadSelection(store.doc, store.selection, format, format === 'png' ? 2 : 1), undefined, () => exportRoots(expand(store.doc), store.selection).length > 0);
    add('home', 'All files', 'Navigate', () => location.assign('/'));
    add('new', 'New file', 'Navigate', newFile);
    add('fit', 'Zoom to fit', 'View', () => {
        const roots = exportRoots(store.doc, store.doc.keys()); if (!roots.length) return;
        const r = exportBounds(store.doc, roots);
        viewport.zoom = Math.max(.05, Math.min(16, (renderer.width - 80) / Math.max(1, r.w), (renderer.height - 80) / Math.max(1, r.h)));
        viewport.x = (renderer.width - r.w * viewport.zoom) / 2 - r.x * viewport.zoom;
        viewport.y = (renderer.height - r.h * viewport.zoom) / 2 - r.y * viewport.zoom; viewport.changed();
    }, undefined, () => store.doc.size > 0);
    for (const [id, title, key, shift] of [['group', 'Group selection', 'g', false], ['ungroup', 'Ungroup selection', 'g', true], ['duplicate', 'Duplicate selection', 'd', false], ['delete', 'Delete selection', 'Delete', false]] as const)
        add(id, title, 'Layers', () => { registry.get('select')?.onKey?.(new KeyboardEvent('keydown', { key, ctrlKey: key !== 'Delete', shiftKey: shift })); }, undefined, () => store.selection.size > 0);
    for (const key of ['hidden', 'locked'] as const) add('toggle-' + key, key === 'hidden' ? 'Toggle selection visibility' : 'Toggle selection lock', 'Layers', () => { store.begin(); for (const id of store.selection) { const n = store.doc.get(id); if (n) store.set(id, { [key]: !n[key] }); } store.end(); }, undefined, () => store.selection.size > 0);
    let removeDynamic: (() => void)[] = [];
    const open = installPalette(renderer.canvas, () => {
        removeDynamic.forEach(fn => fn()); removeDynamic = [];
        for (const id of registry.keys()) removeDynamic.push(add('tool-' + id, id[0].toUpperCase() + id.slice(1) + ' tool', 'Tools', () => choose(id), keys[id]));
        const seen = new Set<string>();
        document.querySelectorAll<HTMLButtonElement>('header button, footer button, aside button, .feature-panel button, .preview-banner button, .comment-pop button, .present-overlay button').forEach((button, i) => {
            if (!button.getClientRects().length || button.disabled || button.closest('[inert], .stop-strip') || button.dataset.tool || button.id === 'command-hint') return;
            const title = button.getAttribute('aria-label') || button.title || button.textContent?.trim();
            if (!title || seen.has(title)) return; seen.add(title);
            const group = button.matches('.inspect-copy, .export-buttons button, .layer-disclosure') ? 'View' : button.closest('aside') ? 'Panels' : button.closest('.comment-pop') ? 'Comments' : 'Actions';
            removeDynamic.push(add('button-' + i, title, group, () => { if (!button.closest('[inert]')) button.click(); }));
        });
        document.querySelectorAll<HTMLInputElement>('header input[type=checkbox]').forEach((input, i) => removeDynamic.push(add('check-' + i, 'Toggle ' + input.parentElement!.textContent!.trim(), 'View', () => input.click())));
    });
    const hint = document.createElement('button'); hint.id = 'command-hint'; hint.textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Commands ⌘K' : 'Commands Ctrl K'; hint.onclick = open;
    document.querySelector('footer')!.prepend(hint);
}
