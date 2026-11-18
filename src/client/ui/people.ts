import type { Sync } from '../sync';
import type { Viewport } from '../viewport';
export function people(el: HTMLElement, sync: Sync, viewport: Viewport) { const render = () => { el.replaceChildren(); for (const p of [...sync.peers.values(), ...(sync.you ? [sync.you] : [])]) {
    const b = document.createElement('button');
    b.className = 'avatar';
    b.style.background = p.color;
    b.textContent = p.name.slice(0, 1);
    b.title = p.name + (p.id === sync.you?.id ? ' (you)' : ' — follow viewport');
    b.onclick = () => { viewport.x = p.viewport.x; viewport.y = p.viewport.y; viewport.zoom = p.viewport.zoom; viewport.changed(); };
    el.append(b);
} document.querySelector('#connection')!.textContent = sync.status; document.querySelector('#connection')!.classList.toggle('live', sync.status === 'Live'); }; sync.addEventListener('change', render); render(); }
