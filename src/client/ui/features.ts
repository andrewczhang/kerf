import { shortcutsPanel } from './shortcuts';
import './features.css';
import { present } from './present';
import { historyPanel } from './history';
import { comments } from './comments';
import type { Renderer } from '../renderer';
import type { Sync } from '../sync';
import type { Context } from '../tools/tool';
export function features(renderer: Renderer, sync: Sync, ctx: Context, choose: (id: string) => void) {
    const header = document.querySelector('header')!;
    window.addEventListener('keydown', e => {
        if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'Digit4' && ctx.snap) {
            e.preventDefault(); ctx.snap.layoutGrids = ctx.snap.layoutGrids === false; renderer.invalidate();
        }
    });
    const add = (text: string, fn: () => void) => { const b = document.createElement('button'); b.className = 'feature-button'; b.textContent = text; b.onclick = fn; header.append(b); };
    add('Present', () => present(ctx.store)); add('History', historyPanel(sync, renderer));
    const toggleShortcuts = shortcutsPanel(header);
    add('?', () => toggleShortcuts());
    const help = header.lastElementChild as HTMLElement;
    help.title = 'Keyboard shortcuts (?)';
    help.setAttribute('aria-label', help.title);
    help.classList.add('shortcuts-button');
    const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.onchange = () => { renderer.showLinks = check.checked; renderer.invalidate(); }; label.append(check, ' Show links'); header.append(label);
    comments(sync, ctx, renderer.canvas, choose);
    window.addEventListener('keydown', e => { if ((e.target as HTMLElement).matches('input,textarea,select') || e.ctrlKey || e.metaKey) return; if (e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); present(ctx.store); } if (e.key.toLowerCase() === 'c') choose('comment'); });
}
