import type { Sync } from '../sync';
import type { Presence } from '../presence';

export function people(el: HTMLElement, sync: Sync, presence: Presence, canvasWrap: HTMLElement) {
    const avatars = new Map<string, HTMLButtonElement>();
    const spotlight = document.createElement('button');
    spotlight.className = 'spotlight-toggle';
    spotlight.onclick = () => presence.toggleSpotlight();
    el.append(spotlight);

    const frame = document.createElement('div');
    frame.className = 'follow-frame';
    frame.setAttribute('aria-hidden', 'true');
    const banner = document.createElement('div');
    banner.className = 'follow-banner';
    const label = document.createElement('span');
    label.setAttribute('role', 'status');
    const stop = document.createElement('button');
    stop.onclick = () => presence.presenting ? presence.toggleSpotlight() : presence.stopFollowing();
    banner.append(label, stop);
    canvasWrap.append(frame, banner);
    const connection = document.querySelector('#connection')!;

    const render = () => {
        const { following, presenter, presenting } = presence;
        for (const [id, avatar] of avatars) {
            if (!sync.peers.has(id) && id !== sync.you?.id) {
                avatar.remove();
                avatars.delete(id);
            }
        }
        for (const peer of [...sync.peers.values(), ...(sync.you ? [sync.you] : [])]) {
            const own = peer.id === sync.you?.id;
            let avatar = avatars.get(peer.id);
            if (!avatar) {
                avatar = document.createElement('button');
                avatar.className = 'avatar';
                avatar.onclick = () => own ? presence.toggleSpotlight() : presence.toggleFollow(peer.id);
                el.insertBefore(avatar, spotlight);
                avatars.set(peer.id, avatar);
            }
            const pressed = own ? presenting : following?.id === peer.id;
            avatar.style.backgroundColor = peer.color;
            avatar.textContent = peer.name.slice(0, 1);
            avatar.title = own ? `${peer.name} (you) — toggle spotlight` : `Follow ${peer.name}`;
            avatar.setAttribute('aria-label', avatar.title);
            avatar.setAttribute('aria-pressed', String(pressed));
            avatar.disabled = own ? sync.status !== 'Live' : presenting;
        }
        spotlight.textContent = presenting ? 'Stop spotlight' : 'Spotlight';
        spotlight.disabled = sync.status !== 'Live';
        spotlight.setAttribute('aria-pressed', String(presenting));

        const color = (presenting ? sync.you : following ?? presenter)?.color;
        frame.hidden = !following && !presenting;
        banner.hidden = !following && !presenter && !presenting;
        for (const overlay of [frame, banner]) overlay.style.setProperty('--follow-color', color ?? '');
        const message = presenting ? 'You are presenting' :
            following && following.id !== presenter?.id ? `Following ${following.name}` :
                presenter ? `${presenter.name} is presenting` : '';
        if (label.textContent !== message) label.textContent = message;
        stop.hidden = !following && !presenting;
        stop.textContent = presenting ? 'Stop spotlight' : 'Stop following';

        connection.textContent = sync.status;
        connection.classList.toggle('live', sync.status === 'Live');
    };
    sync.addEventListener('change', render);
    presence.addEventListener('change', render);
    render();
}
