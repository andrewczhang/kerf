import type { Point } from '../../shared/geometry';
import type { Store } from '../store';
import type { Viewport } from '../viewport';
export interface Context {
    snap?: import('../snapping').SnapState;
    store: Store;
    viewport: Viewport;
    invalidate: () => void;
    marquee?: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    hover?: string;
    active?: Tool;
    editingText?: string;
}
export interface Tool {
    id: string;
    cursor: string;
    onPointerDown(p: Point, e: PointerEvent): void;
    onPointerMove(p: Point, e: PointerEvent): void;
    onPointerUp(p: Point, e: PointerEvent): void;
    cancelGesture?(): void;
    /** return true when the key was handled and app shortcuts should not run */
    onKey?(e: KeyboardEvent): boolean | void;
    activate?(): void;
    deactivate?(): void;
    /** world-space overlay, drawn after nodes */
    draw?(c: CanvasRenderingContext2D, zoom: number): void;
    /** the tool draws its own selection chrome */
    ownsSelection?: boolean;
}
export const registry = new Map<string, Tool>();
