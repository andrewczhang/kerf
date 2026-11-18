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
    editingText?: string;
}
export interface Tool {
    id: string;
    cursor: string;
    onPointerDown(p: Point, e: PointerEvent): void;
    onPointerMove(p: Point, e: PointerEvent): void;
    onPointerUp(p: Point, e: PointerEvent): void;
    onKey?(e: KeyboardEvent): void;
}
export const registry = new Map<string, Tool>();
