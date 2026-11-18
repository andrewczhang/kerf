import './home.css';
import { readRecent, removeRecent, newFile, fileId } from '../recent-files';
import { homeTemplates } from './templates';
export function openedAgo(time: number) {
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 1) return 'Opened just now';
    if (minutes < 60) return `Opened ${minutes}m ago`;
    if (minutes < 1440) return `Opened ${Math.floor(minutes / 60)}h ago`;
    return `Opened ${Math.floor(minutes / 1440)}d ago`;
}
export function home() {
    const app = document.querySelector('#app')!;
    app.innerHTML = '<header><a class="wordmark" href="/">kerf</a><span>Space for your next idea.</span></header><main class="home"><div class="home-title"><h1>All files</h1><button class="new-file">New file +</button></div><form class="open-file"><label for="file-link">Open a shared file</label><input id="file-link" placeholder="Paste a file link or ID" required><button>Open ↗</button><span role="alert"></span></form><div class="recent-heading"><span>Recent files</span><span>Stored on this browser</span></div><div class="recent-list"></div></main>';
    app.querySelector('.new-file')!.addEventListener('click', newFile);
    app.querySelector('.recent-heading')!.before(homeTemplates());
    const form = app.querySelector('form')!; form.onsubmit = e => { e.preventDefault(); const id = fileId(form.querySelector('input')!.value); if (id) location.assign('/f/' + id); else form.querySelector('[role=alert]')!.textContent = 'Enter a valid file link or ID.'; };
    function render() {
        const list = app.querySelector('.recent-list')!; list.replaceChildren();
        const files = readRecent();
        if (!files.length) { list.innerHTML = '<div class="home-empty"><h2>A clean slate.</h2><p>Create a file or open a shared link. Your recent work will appear here.</p></div>'; return; }
        for (const file of files) {
            const row = document.createElement('div'); row.className = 'recent-row';
            const link = document.createElement('a'); link.href = '/f/' + file.id;
            const thumb = document.createElement('div'); thumb.className = 'recent-thumbnail';
            if (file.thumbnail) { const img = document.createElement('img'); img.src = file.thumbnail; img.alt = ''; thumb.append(img); } else thumb.textContent = '—';
            const name = document.createElement('span'); name.className = 'recent-name'; name.textContent = file.name;
            const id = document.createElement('small'); id.textContent = file.id; name.append(id);
            const time = document.createElement('time'); time.dateTime = new Date(file.opened).toISOString(); time.textContent = openedAgo(file.opened);
            link.append(thumb, name, time);
            const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove ' + file.name + ' from recents'); remove.onclick = () => { removeRecent(file.id); render(); };
            row.append(link, remove); list.append(row);
        }
    }
    window.addEventListener('storage', render); render();
}
