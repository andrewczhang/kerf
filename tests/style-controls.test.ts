import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Node } from '../src/shared/doc';
import { expand, instanceNode } from '../src/shared/components';
import { styleValues, type Style } from '../src/shared/styles';
import { styleControl } from '../src/client/ui/styles';
import { Store } from '../src/client/store';
import type { Sync } from '../src/client/sync';

class Element {
    children: Element[] = []; parent?: Element;
    className = ''; textContent = ''; style = {}; onclick?: () => void;
    classList = { add() {} };
    get firstElementChild() { return this.children[0]; }
    get childElementCount() { return this.children.length; }
    append(...nodes: Element[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    after(node: Element) { node.parent = this.parent; this.parent?.children.splice(this.parent.children.indexOf(this) + 1, 0, node); }
    remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
    querySelector() { return undefined; }
    setAttribute() {} blur() {}
}
afterEach(() => vi.unstubAllGlobals());
function fixture() {
    vi.stubGlobal('document', { createElement: () => new Element() });
    const store = new Store(), main = { ...makeNode('frame', 0, 0), component: true, stroke: '#234567' };
    const child = { ...makeNode('rect', 0, 0), parent: main.id, stroke: '#234567' }, text = { ...makeNode('text', 0, 0), parent: main.id }, instance = instanceNode(main, 200, 0);
    store.init([main, child, text, instance]); return { store, main, child, text, instance };
}
function control(store: Store, node: Node, style: Style | undefined, target: 'fill' | 'stroke' | 'text') {
    const parent = new Element(); parent.append(new Element());
    const linked = styleControl(parent as unknown as HTMLElement, store, { styles: style ? [style] : [] } as unknown as Sync, [node], target);
    return { parent, linked };
}
it.each(['root', 'virtual', 'ordinary'] as const)('applies and detaches color styles on %s nodes with undo and redo', kind => {
    for (const target of ['fill', 'stroke'] as const) {
        const { store, main, child, instance } = fixture();
        const id = kind === 'root' ? instance.id : kind === 'virtual' ? instance.id + '/' + child.id : child.id;
        const style: Style = { id: 'accent', kind: 'color', name: 'Accent', color: '#123456' }, key = target === 'fill' ? 'fillStyle' : 'strokeStyle';
        const original = expand(store.doc).get(id)!, { parent, linked } = control(store, original, style, target);
        expect(linked).toBe(false);
        parent.children[0].children[0].onclick!(); parent.children[1].children[0].onclick!();
        const expected = styleValues(style, target);
        expect(expand(store.doc).get(id)).toMatchObject(expected);
        if (kind !== 'ordinary') expect(store.doc.get(instance.id)?.overrides?.[kind === 'root' ? '' : child.id]).toMatchObject(expected);
        expect(store.doc.get(main.id)).toMatchObject({ fill: main.fill, stroke: main.stroke });
        store.history(); expect(expand(store.doc).get(id)?.[target]).toBe(original[target]);
        store.history(true); expect(expand(store.doc).get(id)).toMatchObject(expected);
        const next = control(store, expand(store.doc).get(id)!, style, target);
        expect(next.linked).toBe(true); next.parent.children[1].children[1].onclick!();
        expect(expand(store.doc).get(id)?.[key]).toBeNull(); expect(expand(store.doc).get(id)?.[target]).toBe(style.color);
        store.history(); expect(expand(store.doc).get(id)?.[key]).toBe(style.id);
    }
});
it('applies typography as virtual text overrides and leaves empty style pickers unchanged', () => {
    const { store, text, instance } = fixture(), id = instance.id + '/' + text.id;
    const style: Style = { id: 'title', kind: 'text', name: 'Title', fontFamily: 'serif', fontSize: 48, fontWeight: 700 };
    const { parent } = control(store, expand(store.doc).get(id)!, style, 'text');
    parent.children[0].children[0].onclick!(); parent.children[1].children[0].onclick!();
    expect(expand(store.doc).get(id)).toMatchObject(styleValues(style, 'text'));
    expect(store.doc.get(text.id)?.fontSize).toBe(text.fontSize);
    const count = store.undoStack.length, empty = control(store, expand(store.doc).get(id)!, undefined, 'text');
    empty.parent.children[0].children[0].onclick!();
    expect(empty.parent.children[1].children[0].textContent).toBe('No styles yet'); expect(store.undoStack).toHaveLength(count);
});
it.each(['fill', 'stroke', 'text'] as const)('freezes inherited %s appearance when detaching an instance layer style', target => {
    const { store, main, child, text, instance } = fixture(), source = target === 'text' ? text : child, id = instance.id + '/' + source.id;
    const style: Style = target === 'text' ? { id: 'title', kind: 'text', name: 'Title', fontFamily: 'serif', fontSize: 32, fontWeight: 700 } : { id: 'accent', kind: 'color', name: 'Accent', color: '#123456' };
    store.set(source.id, styleValues(style, target));
    const before = expand(store.doc).get(id)!, { parent, linked } = control(store, before, style, target);
    expect(linked).toBe(true); parent.children[1].children[1].onclick!();
    const changed: Style = style.kind === 'color' ? { ...style, color: '#abcdef' } : { ...style, fontSize: 64 };
    store.set(source.id, styleValues(changed, target));
    const resolved = expand(store.doc).get(id)!;
    expect(resolved[target === 'text' ? 'fontSize' : target]).toBe(before[target === 'text' ? 'fontSize' : target]);
    expect(resolved[target === 'text' ? 'textStyle' : target === 'fill' ? 'fillStyle' : 'strokeStyle']).toBeNull();
    if (target === 'fill') expect(resolved.fills).toEqual(before.fills);
    expect(store.doc.get(main.id)?.overrides).toBeUndefined();
});
