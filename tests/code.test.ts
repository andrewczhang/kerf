import { describe, expect, it } from 'vitest';
import { applyOp, makeNode } from '../src/shared/doc';
import { componentName, toHTML, toReact } from '../src/shared/codegen';
import { parseJSX, type CodeElement } from '../src/shared/jsxparse';
import { codeRoot, codeScopeIds, diffCode } from '../src/client/codesync';
import { Store } from '../src/client/store';

function fixture() {
    const frame = { ...makeNode('frame', 20, -10, 'A'), id: 'frame', name: 'Color study', w: 600, h: 400, radius: 12 };
    const nested = { ...makeNode('frame', 12, 24, 'A'), id: 'nested', parent: frame.id, name: 'Inner "frame" & detail', w: 300, h: 200, opacity: .8 };
    const rect = { ...makeNode('rect', -5.25, 10.5, 'A'), id: 'rect', parent: nested.id, radius: 16, stroke: '#232b30', strokeWidth: 2, opacity: .75 };
    const ellipse = { ...makeNode('ellipse', 150, 100, 'B'), id: 'ellipse', parent: frame.id, fill: '#a8c2b4' };
    return new Map([frame, nested, rect, ellipse].map(n => [n.id, n]));
}
function tree(code: string): CodeElement {
    const result = parseJSX(code);
    if ('error' in result) throw new Error(JSON.stringify(result));
    return result;
}
describe('code generation and document diff', () => {
    it('preserves collaborator additions absent from the original draft, including children of removed frames', () => {
        const doc = fixture(), baseline = codeScopeIds(doc, 'frame');
        const parsed = tree(toReact(doc, 'frame'));
        parsed.children.shift();
        const added = { ...makeNode('rect', 7, 8), id: 'remote', parent: 'nested' };
        const sibling = { ...makeNode('rect', 50, 60), id: 'remote-sibling', parent: 'frame' };
        doc.set(added.id, added); doc.set(sibling.id, sibling);
        const ops = diffCode(doc, 'frame', parsed, baseline);
        for (const op of ops) applyOp(doc, op);
        expect(doc.get('remote')).toMatchObject({ parent: 'frame', x: 19, y: 32 });
        expect(doc.get('remote-sibling')).toEqual(sibling);
        expect(doc.has('nested')).toBe(false);
        expect(doc.has('rect')).toBe(false);
    });
    it('round-trips nested frames, names, negative coordinates, ellipses and appearance with zero ops', () => {
        const doc = fixture();
        expect(toReact(doc, 'frame')).toContain('export function ColorStudy()');
        expect(diffCode(doc, 'frame', tree(toReact(doc, 'frame')))).toEqual([]);
        expect(diffCode(doc, null, tree(toReact(doc, null)))).toEqual([]);
        expect(codeRoot(doc, ['rect'])).toBe('frame');
        expect(codeRoot(doc, [])).toBeNull();
    });
    it('turns a width edit into exactly one set and applies as one undo step', () => {
        const doc = fixture(), source = toReact(doc, 'frame').replace('width: 600', 'width: 640');
        const ops = diffCode(doc, 'frame', tree(source));
        expect(ops).toEqual([{ t: 'set', id: 'frame', key: 'w', value: 640 }]);
        const store = new Store(); store.init([...doc.values()]); store.commit(ops);
        expect(store.undoStack).toHaveLength(1);
        store.history(); expect(store.doc.get('frame')?.w).toBe(600);
    });
    it('creates new divs, infers ellipses and keeps sibling order', () => {
        const doc = fixture(), parsed = tree(toReact(doc, 'frame'));
        parsed.children.unshift(tree('<div style={{ left: 1, top: 2, width: 30, height: 40, background: "#112233", borderRadius: "50%" }} />'));
        const ops = diffCode(doc, 'frame', parsed);
        expect(ops).toHaveLength(1); expect(ops[0].t).toBe('create');
        if (ops[0].t === 'create') {
            expect(ops[0].node).toMatchObject({ type: 'ellipse', parent: 'frame', x: 1, y: 2, w: 30, h: 40, fill: '#112233' });
            expect(ops[0].node.index < 'A').toBe(true);
        }
    });
    it('deletes removed nodes without touching another root', () => {
        const doc = fixture(), other = { ...makeNode('rect', 800, 0, 'B'), id: 'other' };
        doc.set(other.id, other);
        const parsed = tree(toReact(doc, 'frame')); parsed.children.pop();
        expect(diffCode(doc, 'frame', parsed)).toEqual([{ t: 'delete', id: 'ellipse' }]);
        parsed.children = [];
        expect(diffCode(doc, 'frame', parsed)).toEqual([{ t: 'delete', id: 'nested' }, { t: 'delete', id: 'ellipse' }]);
    });
    it('handles empty documents and fragments, and infers empty frames', () => {
        expect(diffCode(new Map(), null, tree(toReact(new Map(), null)))).toEqual([]);
        const ops = diffCode(new Map(), null, tree('<><div data-type="frame" /></>'));
        expect(ops[0].t === 'create' && ops[0].node.type).toBe('frame');
        const rect = diffCode(new Map(), null, tree('<div />'))[0];
        expect(rect.t === 'create' && rect.node.type).toBe('rect');
    });
    it('supports reorder and reparent without losing retained children', () => {
        const doc = fixture(), parsed = tree(toReact(doc, 'frame'));
        const ellipse = parsed.children.pop()!;
        parsed.children[0].children.push(ellipse);
        const ops = diffCode(doc, 'frame', parsed);
        for (const op of ops) applyOp(doc, op);
        expect(doc.get('ellipse')?.parent).toBe('nested');
        expect(diffCode(doc, 'frame', parsed)).toEqual([]);
    });
    it('rejects unsupported, invalid, duplicate and out-of-scope edits before producing ops', () => {
        const doc = fixture();
        expect(() => diffCode(doc, 'frame', tree('<div data-kerf="other" />'))).toThrow('scope');
        expect(() => diffCode(doc, 'frame', tree('<div style={{ width: -1 }} />'))).toThrow('positive');
        expect(() => diffCode(doc, 'frame', tree('<div style={{ padding: 10 }} />'))).toThrow('unsupported');
        expect(() => diffCode(doc, 'frame', tree('<><div data-kerf="rect" /><div data-kerf="rect" /></>'))).toThrow('duplicate');
        expect(() => diffCode(doc, 'gone', tree('<></>'))).toThrow('deleted');
    });
    it('generates standalone escaped HTML with inline CSS and no executable content', () => {
        const doc = fixture(); doc.get('rect')!.name = '"><script>alert(1)</script>';
        const html = toHTML(doc, 'frame');
        expect(html).toContain('<!doctype html>');
        expect(html).toContain('border-radius: 50%');
        expect(html).toContain('overflow: hidden');
        expect(html).not.toContain('<script>');
        expect(componentName('123 / a study')).toBe('Frame123AStudy');
    });
});
describe('constrained JSX parser', () => {
    it('accepts comments, fragments, both quote styles, escapes, numbers and self-closing tags', () => {
        const result = tree(`/* start */ export function Test() { return (<> {/* child */}<div data-name='Sam\\'s' style={{ left: -12.5, top: .25, background: "#ff4f00", }} /></>); } // end`);
        expect(result.children[0].attrs['data-name']).toBe("Sam's");
        expect(result.children[0].style.left).toBe(-12.5);
    });
    it('reports exact line and column for missing style values and mismatched closing tags', () => {
        expect(parseJSX('<div\n  style={{ width: }}\n/>')).toEqual({ error: 'expected a string or number', line: 2, col: 19 });
        expect(parseJSX('<div>\n</span>')).toEqual({ error: "expected 'div'", line: 2, col: 3 });
    });
    it('rejects empty, unterminated, dynamic and executable input', () => {
        for (const source of ['', '<div', '<div style={{ width: window.x }} />', '<script />', '<div data-name="oops', '/*']) expect(parseJSX(source)).toHaveProperty('error');
    });
});
