import { between, descendants, makeNode, validNode, type Doc, type Node, type Op, type Key } from '../shared/doc';
import { defaultName } from '../shared/codegen';
import type { CodeElement } from '../shared/jsxparse';

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

export function diffCode(doc: Doc, rootId: string | null, tree: CodeElement): Op[] {
    const root = rootId ? doc.get(rootId) : undefined;
    if (rootId && !root) throw new CodeDiffError('the edited frame was deleted', tree.line, tree.col);
    const scope = new Set(root ? [root.id, ...descendants(doc, root.id).map(n => n.id)] : doc.keys());
    const seen = new Set<string>(), ops: Op[] = [];
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
            const type = style.borderRadius === '50%' ? 'ellipse' : nested.length || attrs['data-type'] === 'frame' ? 'frame' : 'rect';
            if (type === 'ellipse' && nested.length) fail('ellipses cannot contain children');
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
                opacity: number('opacity', 1), strokeWidth: old?.strokeWidth ?? 1,
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
            else for (const key of Object.keys(node) as (keyof Node)[]) if (key !== 'id' && old[key] !== node[key]) ops.push({ t: 'set', id: node.id, key: key as Key, value: node[key] });
            visit(nested, node.id);
        }
    };
    visit([tree], root?.parent ?? null, true);
    const missing = new Set([...scope].filter(id => !seen.has(id)));
    for (const id of missing) if (!missing.has(doc.get(id)?.parent ?? '')) ops.push({ t: 'delete', id });
    return ops;
}
