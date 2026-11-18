import { between, descendants, makeNode, validNode, type Doc, type Node, type Op, type Key } from '../shared/doc';
import { defaultName } from '../shared/codegen';
import type { CodeElement } from '../shared/jsxparse';
import { world } from '../shared/geometry';
import type { Store } from './store';

const codeKeys: Key[] = ['type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'stroke', 'strokeWidth', 'radius', 'opacity'];

export function commitCode(store: Store, ops: Op[]): void {
    if (ops.length > 1000) throw new CodeDiffError(`Too many changes at once (${ops.length}); split the edit`, 1, 1);
    if (ops.length) store.commit(ops);
}

export function codeScopeIds(doc: Doc, rootId: string | null): Set<string> {
    return new Set(rootId ? [rootId, ...descendants(doc, rootId).map(n => n.id)] : doc.keys());
}

export function codeRoot(doc: Doc, selection: Iterable<string>): string | null {
    let node = doc.get([...selection][0]);
    let root: string | null = null;
    while (node) {
        if (node.type === 'frame') root = node.id;
        node = node.parent ? doc.get(node.parent) : undefined;
    }
    return root;
}

export class CodeDiffError extends Error {
    constructor(message: string, public line: number, public col: number) { super(message); }
}

function flatten(nodes: CodeElement[]): CodeElement[] {
    return nodes.flatMap(node => node.tag === 'fragment' ? flatten(node.children) : [node]);
}

export function diffCode(doc: Doc, rootId: string | null, tree: CodeElement, baselineIds?: ReadonlySet<string>): Op[] {
    const root = rootId ? doc.get(rootId) : undefined;
    if (rootId && !root) throw new CodeDiffError('the edited frame was deleted', tree.line, tree.col);
    const scope = codeScopeIds(doc, rootId);
    const seen = new Set<string>(), convertedFrames = new Set<string>(), ops: Op[] = [];
    const visit = (elements: CodeElement[], parent: string | null, top = false) => {
        const siblings = flatten(elements);
        let previous: string | null = null;
        for (let i = 0; i < siblings.length; i++) {
            const element = siblings[i], { attrs, style } = element;
            const fail = (message: string): never => { throw new CodeDiffError(message, element.line, element.col); };
            for (const key of Object.keys(attrs)) if (!['data-kerf', 'data-name', 'data-type'].includes(key)) fail(`unsupported attribute '${key}'`);
            for (const key of Object.keys(style)) if (!['position', 'left', 'top', 'width', 'height', 'background', 'borderRadius', 'opacity', 'border', 'overflow'].includes(key)) fail(`unsupported style '${key}'`);
            if (style.position !== undefined && !['relative', 'absolute'].includes(String(style.position))) fail('position must be relative or absolute');
            if (style.overflow !== undefined && style.overflow !== 'hidden') fail('overflow must be hidden');
            if (attrs['data-type'] !== undefined && attrs['data-type'] !== 'frame') fail('data-type must be frame');
            const id = attrs['data-kerf'];
            if (id !== undefined && (!id || !scope.has(id))) fail('data-kerf must identify an element in this code scope');
            if (id && seen.has(id)) fail('duplicate data-kerf');
            const old = id ? doc.get(id) : undefined;
            const nested = flatten(element.children);
            const type = old && ['text', 'path', 'group'].includes(old.type) ? old.type : style.borderRadius === '50%' ? 'ellipse' : nested.length || attrs['data-type'] === 'frame' ? 'frame' : 'rect';
            if (old?.type === 'frame' && type !== 'frame') convertedFrames.add(old.id);
            if (nested.length && (!['frame', 'group'].includes(type) || old && !['frame', 'group'].includes(old.type))) fail('only frames and groups can contain children');
            const number = (key: string, fallback: number) => {
                const value = style[key] ?? fallback;
                if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} must be a finite number`);
                return value as number;
            };
            const background = style.background ?? (type === 'frame' ? '#ffffff' : '#ff4f00');
            if (typeof background !== 'string' || !/^#[\da-f]{6}$/i.test(background)) fail('background must be a six-digit hex color');
            const relativeRoot = top && style.position === 'relative';
            const node = makeNode(type, number('left', relativeRoot ? old?.x ?? 0 : 0), number('top', relativeRoot ? old?.y ?? 0 : 0));
            Object.assign(node, {
                id: id ?? node.id, parent, name: attrs['data-name'] ?? defaultName(type),
                w: number('width', 100), h: number('height', 100), fill: background,
                radius: type === 'ellipse' ? old?.radius ?? 0 : number('borderRadius', 0),
                opacity: number('opacity', 1), stroke: null, strokeWidth: old?.strokeWidth ?? 1,
            });
            if (style.border !== undefined) {
                if (typeof style.border !== 'string') fail('border must be a CSS border string');
                const border = String(style.border).match(/^(\d+(?:\.\d+)?)px solid (#[\da-f]{6})$/i);
                if (!border) fail("border must look like '1px solid #232b30'");
                node.strokeWidth = Number(border![1]); node.stroke = border![2];
            }
            if (!validNode(node)) fail('sizes must be positive, radius nonnegative and opacity between 0 and 1');
            if (old && (previous === null || old.index > previous)) node.index = old.index;
            else {
                const next = siblings.slice(i + 1).map(e => doc.get(e.attrs['data-kerf'])?.index).find(index => index !== undefined && (previous === null || index > previous));
                node.index = between(previous, next ?? null);
            }
            previous = node.index;
            seen.add(node.id);
            if (!old) ops.push({ t: 'create', node });
            else for (const key of codeKeys) if (old[key] !== node[key]) ops.push({ t: 'set', id: node.id, key, value: node[key] });
            visit(nested, node.id);
        }
    };
    visit([tree], root?.parent ?? null, true);
    const missing = new Set([...scope].filter(id => (baselineIds ?? scope).has(id) && !seen.has(id)));
    for (const id of scope) {
        const node = doc.get(id)!;
        if (missing.has(id) || seen.has(id)) continue;
        let ancestor = node.parent;
        while (ancestor) {
            if (convertedFrames.has(ancestor)) throw new CodeDiffError('A frame contains new collaborator objects; refresh the code before changing its type', tree.line, tree.col);
            ancestor = doc.get(ancestor)?.parent ?? null;
        }
        if (!missing.has(node.parent ?? '')) continue;
        let parent = node.parent;
        while (parent && missing.has(parent)) parent = doc.get(parent)?.parent ?? null;
        const position = world(doc, node), origin = parent ? world(doc, doc.get(parent)!) : { x: 0, y: 0 };
        ops.push({ t: 'set', id, key: 'parent', value: parent }, { t: 'set', id, key: 'x', value: position.x - origin.x }, { t: 'set', id, key: 'y', value: position.y - origin.y });
    }
    for (const id of missing) if (!missing.has(doc.get(id)?.parent ?? '')) ops.push({ t: 'delete', id });
    return ops;
}
