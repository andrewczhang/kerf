const cache = new Map<string, { image?: ImageBitmap; listeners: Set<() => void> }>();
export function assetImage(file: string, hash: string, invalidate: () => void): ImageBitmap | undefined { const key = file + '/' + hash; let entry = cache.get(key); if (!entry) { entry = { listeners: new Set() }; cache.set(key, entry); const item = entry; fetch(`/f/${encodeURIComponent(file)}/assets/${hash}`).then(r => { if (!r.ok) throw Error('Asset unavailable'); return r.blob(); }).then(createImageBitmap).then(image => { item.image = image; for (const notify of item.listeners) notify(); item.listeners.clear(); }).catch(() => { item.listeners.clear(); }); } if (!entry.image) entry.listeners.add(invalidate); return entry.image; }
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
