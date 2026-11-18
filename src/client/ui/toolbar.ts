const icons: Record<string, string> = { select: '<path d="m6 3 12 10-7 1-3 7Z"/>', rect: '<rect x="5" y="5" width="14" height="14"/>', ellipse: '<circle cx="12" cy="12" r="7"/>', frame: '<path d="M8 3v18M16 3v18M3 8h18M3 16h18"/>', hand: '<path d="M7 12V7a1.5 1.5 0 0 1 3 0v4-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v7c0 6-9 7-12 2l-4-5q0-3 3-1l3 3"/>' };
export function toolbar(el: HTMLElement, choose: (id: string) => void) { el.innerHTML = '<span class="wordmark">kerf<span>®</span></span><div class="toolset"></div><span class="bar-divider"></span><span class="file-name">Untitled canvas <span class="subtle">/ Design</span></span><div id="people"></div><span id="connection">Connecting</span><button id="share">Copy link ↗</button>'; const group = el.querySelector('.toolset')!; for (const [i, id] of ['select', 'frame', 'rect', 'ellipse', 'hand'].entries()) {
    const b = document.createElement('button');
    b.dataset.tool = id;
    b.title = `${id} (${['V', 'F', 'R', 'O', 'H'][i]})`;
    b.setAttribute('aria-label', b.title);
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4">${icons[id]}</svg>`;
    b.onclick = () => choose(id);
    group.append(b);
} el.querySelector('#share')!.addEventListener('click', async () => { await navigator.clipboard.writeText(location.href); el.querySelector('#share')!.textContent = 'Link copied ✓'; }); }
