const cache = new Map<string, { image?: ImageBitmap; promise: Promise<ImageBitmap>; listeners: Set<() => void> }>();
const assetRoute = () => typeof location !== 'undefined' && location.pathname?.startsWith('/v/') ? 'v' : 'f';
export function loadAsset(file: string, hash: string): Promise<ImageBitmap> { const key = file + '/' + hash, cached = cache.get(key); if (cached) return cached.promise; const listeners = new Set<() => void>(), entry = { image: undefined as ImageBitmap | undefined, listeners, promise: fetch(`/${assetRoute()}/${encodeURIComponent(file)}/assets/${hash}`).then(r => { if (!r.ok) throw Error('Asset unavailable'); return r.blob(); }).then(createImageBitmap).then(image => { entry.image = image; for (const notify of listeners) notify(); listeners.clear(); return image; }) }; entry.promise.catch(() => { listeners.clear(); cache.delete(key); }); cache.set(key, entry); return entry.promise; }
export function assetImage(file: string, hash: string, invalidate: () => void): ImageBitmap | undefined { void loadAsset(file, hash).catch(() => {}); const entry = cache.get(file + '/' + hash)!; if (!entry.image) entry.listeners.add(invalidate); return entry.image; }
export async function uploadAsset(file: string, blob: Blob): Promise<{ hash: string; w: number; h: number }> {
    const image = await createImageBitmap(blob), scale = Math.min(1, 2048 / Math.max(image.width, image.height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    const c = canvas.getContext('2d')!; c.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
    const encode = (type: string, quality?: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(Error('Image encoding failed')), type, quality));
    const pixels = c.getImageData(0, 0, canvas.width, canvas.height).data; let transparent = false; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) { transparent = true; break; }
    let encoded = transparent ? await encode('image/png') : undefined;
    if (!encoded || encoded.size > 1.5 * 1024 * 1024) { try { encoded = await encode('image/webp', .86); } catch { encoded = await encode('image/jpeg', .86); } if (encoded.type !== 'image/webp') encoded = await encode('image/jpeg', .86); }
    if (encoded.size > 1.5 * 1024 * 1024) throw Error('Image exceeds 1.5 MB');
    const bytes = await encoded.arrayBuffer(), hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    const response = await fetch(`/f/${encodeURIComponent(file)}/assets/${hash}`, { method: 'PUT', headers: { 'content-type': encoded.type }, body: bytes }); if (!response.ok) throw Error(`Asset upload failed: ${response.status}`);
    return { hash, w: canvas.width, h: canvas.height };
}
export async function copyAsset(from: string, to: string, hash: string) {
    const source = await fetch(`/f/${encodeURIComponent(from)}/assets/${hash}`); if (!source.ok) throw Error('Asset unavailable');
    const blob = await source.blob(), target = await fetch(`/f/${encodeURIComponent(to)}/assets/${hash}`, { method: 'PUT', headers: { 'content-type': blob.type }, body: blob }); if (!target.ok) throw Error(`Asset copy failed: ${target.status}`);
}
