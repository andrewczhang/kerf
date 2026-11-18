import { afterEach, expect, it, vi } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { Store } from '../src/client/store';
import type { Sync } from '../src/client/sync';
import type { Context } from '../src/client/tools/tool';
import { comments } from '../src/client/ui/comments';

afterEach(() => vi.unstubAllGlobals());
it('renders moved anchors only on their actual page and legacy unanchored comments only on the first page', () => {
    class Element {
        children: Element[] = []; style = {}; dataset = {}; hidden = false;
        append(...children: Element[]) { this.children.push(...children); }
        replaceChildren(...children: Element[]) { this.children = children; }
    }
    vi.stubGlobal('document', { createElement: () => new Element(), querySelector: () => new Element() });
    vi.stubGlobal('MutationObserver', class { observe() {} }); vi.stubGlobal('ResizeObserver', class { observe() {} });
    const a = { ...makeNode('page', 0, 0, 'A'), id: 'a' }, b = { ...a, id: 'b', index: 'B' }, rect = { ...makeNode('rect', 0, 0), parent: a.id };
    const store = new Store(); store.enablePages(); store.init([a, b, rect]);
    const sync = Object.assign(new EventTarget(), { comments: [{ id: 'anchor', thread: null, node: rect.id, x: 0, y: 0, text: 'Anchored' }] }) as unknown as Sync;
    const wrap = new Element(), canvas = { parentElement: wrap } as unknown as HTMLCanvasElement;
    comments(sync, { store, viewport: { screen: (p: unknown) => p } } as unknown as Context, canvas, () => {});
    store.changed(); expect(wrap.children[0].children).toHaveLength(1);
    store.remote([{ t: 'set', id: rect.id, key: 'parent', value: b.id }]); expect(wrap.children[0].children).toHaveLength(0);
    store.setPage(b.id); expect(wrap.children[0].children).toHaveLength(1);
    sync.comments = [{ id: 'legacy', thread: null, x: 0, y: 0, text: 'Legacy', author: 'Alex', color: '#123456', at: 0 }];
    store.changed(); expect(wrap.children[0].children).toHaveLength(0);
    store.setPage(a.id); expect(wrap.children[0].children).toHaveLength(1);
    sync.comments = [{ ...sync.comments[0], page: b.id }]; store.changed(); expect(wrap.children[0].children).toHaveLength(0);
    store.setPage(b.id); expect(wrap.children[0].children).toHaveLength(1);
    sync.comments = []; store.changed(); expect(wrap.children[0].children).toHaveLength(0);
});
