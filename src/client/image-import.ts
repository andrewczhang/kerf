import { between, children, makeNode, nodeFills, type Paint } from '../shared/doc';
import type { Context } from './tools/tool';
import { uploadAsset } from './assets';
import { writeFills } from './paint-edit';
import { hasLayerClipboard, layerCopyPending, pasteLayers } from './tools/select';
export function uploadStatus(message: string) { const el = document.querySelector<HTMLElement>('#upload-status'); if (el) { el.textContent = message; el.title = message; } }
export function imageImport(canvas: HTMLCanvasElement, ctx: Context, file: string) {
    const status = document.createElement('span'); status.id = 'upload-status'; status.setAttribute('role', 'status'); document.querySelector('footer')!.insertBefore(status, document.querySelector('#connection'));
    const receive = async (files: File[], point?: { x: number; y: number }) => {
        if (ctx.store.readOnly || canvas.style.pointerEvents === 'none') return;
        const selected = !point && ctx.store.selection.size === 1 ? [...ctx.store.selection][0] : undefined;
        uploadStatus('Uploading image'); try { for (const source of files) { const asset = await uploadAsset(file, source), paint: Paint = { type: 'image', asset: asset.hash, fit: 'fill', w: asset.w, h: asset.h, opacity: 1, visible: true }, n = selected && ctx.store.doc.get(selected); ctx.store.begin(); try { if (n && (n.type === 'rect' || n.type === 'ellipse' || n.type === 'frame')) { const fills = nodeFills(n); if (fills.length >= 12) throw Error('Maximum 12 fills'); writeFills(ctx.store, n.id, [...fills, paint]); } else { const rect = canvas.getBoundingClientRect(), center = point ?? ctx.viewport.world({ x: rect.width / 2, y: rect.height / 2 }), scale = Math.min(1, 800 / Math.max(asset.w, asset.h)), node = { ...makeNode('rect', center.x - asset.w * scale / 2, center.y - asset.h * scale / 2, between(children(ctx.store.doc, null).at(-1)?.index ?? null)), name: source.name || 'Image', w: Math.max(1, asset.w * scale), h: Math.max(1, asset.h * scale), fills: [paint] }; ctx.store.commit([{ t: 'create', node }]); ctx.store.selection.clear(); ctx.store.selection.add(node.id); } } finally { ctx.store.end(); ctx.store.changed(); } } uploadStatus('Image uploaded'); } catch (e) { uploadStatus(String(e)); }
    };
    window.addEventListener('copy', e => { if (layerCopyPending() && e.clipboardData) { e.preventDefault(); e.clipboardData.setData('text/plain', 'Kerf layers'); } });
    window.addEventListener('paste', e => { if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return; const files = [...(e.clipboardData?.items ?? [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((f): f is File => !!f); if (files.length) { e.preventDefault(); void receive(files); } else if (canvas.style.pointerEvents !== 'none' && hasLayerClipboard()) { e.preventDefault(); void pasteLayers(ctx.store, file); } });
    canvas.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); }); canvas.addEventListener('drop', e => { e.preventDefault(); const files = [...(e.dataTransfer?.files ?? [])].filter(f => f.type.startsWith('image/')); if (files.length) { const r = canvas.getBoundingClientRect(); void receive(files, ctx.viewport.world({ x: e.clientX - r.left, y: e.clientY - r.top })); } });
}
