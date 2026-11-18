import { expect, it } from 'vitest';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';
import { Shape } from '../src/client/tools/shape';
import { Select } from '../src/client/tools/select';
import type { Context } from '../src/client/tools/tool';
import { makeNode } from '../src/shared/doc';

const event = { shiftKey: false, altKey: false } as PointerEvent;
function context(): Context { return { store: new Store(), viewport: new Viewport(() => {}), invalidate() {} }; }
it('snaps click and drag creation, including constrained ellipses', () => {
    const c = context(), shape = new Shape(c, 'ellipse', () => {});
    shape.onPointerDown({ x: 10.3, y: 20.7 });
    const id = [...c.store.doc.keys()][0];
    expect(c.store.doc.get(id)).toMatchObject({ x: 10, y: 21, w: 100, h: 100 });
    shape.onPointerMove({ x: 63.75, y: 45.9 }, { ...event, shiftKey: true } as PointerEvent);
    expect(c.store.doc.get(id)).toMatchObject({ x: 10, y: 21, w: 54, h: 54 });
    shape.onPointerUp();
});
it('snaps movement and resize at fractional world coordinates', () => {
    const c = context(), n = makeNode('rect', 10.3, 20.6), select = new Select(c);
    c.store.commit([{ t: 'create', node: n }]);
    select.onPointerDown({ x: 50, y: 50 }, event);
    select.onPointerMove({ x: 53.4, y: 54.7 }, event);
    select.onPointerUp({ x: 53.4, y: 54.7 });
    expect(c.store.doc.get(n.id)).toMatchObject({ x: 14, y: 25 });
    select.onPointerDown({ x: 114, y: 125 }, event);
    select.onPointerMove({ x: 126.8, y: 143.2 }, event);
    expect(c.store.doc.get(n.id)).toMatchObject({ x: 14, y: 25, w: 113, h: 118 });
});
it('handles empty selection and movement before creation', () => {
    const c = context(), shape = new Shape(c, 'rect', () => {}), select = new Select(c);
    shape.onPointerMove({ x: 0.1, y: 0.2 }, event);
    select.onPointerDown({ x: 0, y: 0 }, event);
    select.onPointerMove({ x: 20.5, y: 20.5 }, event);
    select.onPointerUp({ x: 20.5, y: 20.5 });
    expect(c.store.doc.size).toBe(0);
});
