import { expect, it } from 'vitest';
import { gradientAngle, gradientEndpoints } from '../src/client/paint-edit';
import type { Paint } from '../src/shared/doc';
it('reads and writes world-space angles while spanning wide, tall and square boxes', () => {
    for (const n of [{ w: 200, h: 100 }, { w: 100, h: 200 }, { w: 100, h: 100 }, { w: 2000, h: 1 }]) for (const angle of [0, 30, 45, 90, 135, -45, 180]) {
        const endpoints = gradientEndpoints(angle, n), p: Extract<Paint, { stops: unknown }> = { type: 'linear', ...endpoints, stops: [], opacity: 1, visible: true }; expect(gradientAngle(p, n)).toBeCloseTo(angle); expect(endpoints.from.x + endpoints.to.x).toBeCloseTo(1); expect(endpoints.from.y + endpoints.to.y).toBeCloseTo(1); expect(Math.max(Math.abs(endpoints.to.x - .5), Math.abs(endpoints.to.y - .5))).toBeCloseTo(.5);
    }
    expect(gradientAngle({ type: 'linear', stops: [], opacity: 1, visible: true, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }, { w: 200, h: 100 })).toBeCloseTo(26.565);
});
