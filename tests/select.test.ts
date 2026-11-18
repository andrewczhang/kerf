import { expect, it } from 'vitest';
import { Select } from '../src/client/tools/select';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';
import { makeNode } from '../src/shared/doc';
import { instanceNode } from '../src/shared/components';
import { Shape } from '../src/client/tools/shape';
function setup() {
    const store = new Store(), main = { ...makeNode('frame', 0, 0), component: true }, child = { ...makeNode('rect', 10, 10), w: 30, h: 30, parent: main.id }, instance = instanceNode(main, 200, 0);
    store.init([main, child, instance]);
    const select = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} });
    const key = (key: string, ctrlKey = false) => select.onKey({ key, ctrlKey, preventDefault() {} } as KeyboardEvent);
    return { store, main, child, instance, select, key };
}
it('selects instances as leaves or deep-selects virtual children without changing them', () => {
    const { select, instance, child, store, key } = setup(), p = { x: 220, y: 20 };
    expect(select.pick(p)?.id).toBe(instance.id);
    expect(select.pick(p, true)?.id).toBe(instance.id + '/' + child.id);
    select.deepSelect(p); key('ArrowRight'); key('Delete'); key('d', true);
    expect(store.doc.size).toBe(3); expect(store.doc.get(child.id)?.x).toBe(10);
    expect(select.pick({ x: -100, y: -100 })).toBeUndefined();
});
it('duplicates a main as an instance and duplicates an instance with its overrides', () => {
    const { store, main, key } = setup(); store.selection.add(main.id); key('d', true);
    const id = [...store.selection][0], n = store.doc.get(id)!;
    expect(n.instanceOf).toBe(main.id); expect(n.x).toBe(20); expect(store.doc.size).toBe(4);
    store.commit([{ t: 'override', id, target: '', key: 'fill', value: '#112233' }]); key('d', true);
    expect(store.doc.get([...store.selection][0])?.overrides).toEqual({ '': { fill: '#112233' } });
});
it('detaches surviving instances when deleting a main in one undoable transaction', () => {
    const { store, main, instance, key } = setup(); store.selection.add(main.id); key('Delete');
    expect(store.doc.has(main.id)).toBe(false); expect(store.doc.get(instance.id)?.instanceOf).toBeUndefined();
    expect([...store.doc.values()].some(n => n.parent === instance.id)).toBe(true);
    store.history(); expect(store.doc.get(instance.id)?.instanceOf).toBe(main.id); expect(store.doc.has(main.id)).toBe(true);
});
it('does not reparent on a deep-selection pointerup or drop shapes into instances', () => {
    const { store, select, instance } = setup();
    select.original.set(instance.id, instance); select.moved = true;
    select.onPointerDown({ x: 220, y: 20 }, { ctrlKey: true } as PointerEvent);
    select.onPointerUp({ x: 10, y: 10 });
    expect(store.doc.get(instance.id)?.parent).toBeNull();
    const shape = new Shape(select.ctx, 'rect', () => {});
    shape.onPointerDown({ x: 220, y: 20 }); shape.onPointerUp();
    expect(store.doc.get([...store.selection][0])?.parent).toBeNull();
});
