import type { Paint } from '../shared/doc';
import type { Rect } from '../shared/geometry';
import { assetImage } from './assets';
export function rgba(color: string, opacity: number) { return color + Math.round(opacity * 255).toString(16).padStart(2, '0'); }
export function paintStyle(c: CanvasRenderingContext2D, p: Paint, r: Rect, file: string, invalidate: () => void): string | CanvasGradient | CanvasPattern | undefined {
    if (p.type === 'solid') return p.color;
    if (p.type === 'image') { const image = assetImage(file, p.asset, invalidate); if (!image) return; const pattern = c.createPattern(image, p.fit === 'tile' ? 'repeat' : 'no-repeat'); if (!pattern) return; const scale = p.fit === 'tile' ? 1 : (p.fit === 'fill' ? Math.max : Math.min)(r.w / p.w, r.h / p.h), w = p.w * scale, h = p.h * scale; pattern.setTransform(new DOMMatrix().translate(r.x + (p.fit === 'tile' ? 0 : (r.w - w) / 2), r.y + (p.fit === 'tile' ? 0 : (r.h - h) / 2)).scale(w / image.width, h / image.height)); return pattern; }
    const gradient = p.type === 'linear' ? c.createLinearGradient(p.from.x, p.from.y, p.to.x, p.to.y) : c.createRadialGradient(p.from.x, p.from.y, 0, p.from.x, p.from.y, Math.max(.000001, Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y)));
    for (const stop of [...p.stops].sort((a, b) => a.pos - b.pos)) gradient.addColorStop(stop.pos, rgba(stop.color, stop.opacity)); return gradient;
}
