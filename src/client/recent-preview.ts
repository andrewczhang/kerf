import { children } from '../shared/doc';
import { drawNode } from './draw';
import { exportBounds, exportRoots } from './export';
import { recordRecent } from './recent-files';
import type { Store } from './store';
export function trackRecent(store: Store, file: string) {
    recordRecent({ id: file, opened: Date.now() });
    let timer: ReturnType<typeof setTimeout> | undefined;
    function refresh() {
        clearTimeout(timer); timer = undefined;
        try {
            const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
            const c = canvas.getContext('2d')!; c.fillStyle = '#f4f3ef'; c.fillRect(0, 0, 320, 200);
            const roots = exportRoots(store.doc, store.doc.keys());
            if (roots.length) {
                const r = exportBounds(store.doc, roots), scale = Math.min(296 / Math.max(1, r.w), 176 / Math.max(1, r.h));
                c.translate((320 - r.w * scale) / 2, (200 - r.h * scale) / 2); c.scale(scale, scale); c.translate(-r.x, -r.y);
                for (const n of children(store.doc, null)) drawNode(c, store.doc, n, { zoom: scale, scale, labels: false, file });
            }
            recordRecent({ id: file, thumbnail: canvas.toDataURL('image/png') });
        } catch { /* A preview must never interrupt editing. */ }
    }
    store.addEventListener('change', () => { clearTimeout(timer); timer = setTimeout(refresh, 3000); });
    window.addEventListener('pagehide', refresh);
}
