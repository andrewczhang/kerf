import { children, type Doc, type Node } from './doc';

export type CodeStyle = Record<string, string | number>;
export const defaultName = (type: Node['type']) => ({ page: 'Page', frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', group: 'Group', text: 'Text', path: 'Path' })[type];

export function componentName(name: string): string {
    const result = name.split(/[^a-zA-Z0-9]+/).filter(Boolean).map(word => word[0].toUpperCase() + word.slice(1)).join('');
    return !result ? 'Canvas' : /^\d/.test(result) ? 'Frame' + result : result;
}

export function escapeHTML(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
}

function quote(value: string): string {
    return "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + "'";
}

export function nodeStyle(node: Node, relative = false): CodeStyle {
    const style: CodeStyle = { position: relative ? 'relative' : 'absolute' };
    if (!relative) { style.left = node.x; style.top = node.y; }
    Object.assign(style, { width: node.w, height: node.h, background: node.fill });
    if (node.type === 'frame') style.overflow = 'hidden';
    if (node.type === 'ellipse') style.borderRadius = '50%';
    else if (node.radius) style.borderRadius = node.radius;
    if (node.opacity !== 1) style.opacity = node.opacity;
    if (node.stroke) style.border = `${node.strokeWidth}px solid ${node.stroke}`;
    return style;
}

function attributes(node: Node): string {
    let attrs = ` data-kerf="${escapeHTML(node.id)}"`;
    if (node.type === 'frame') attrs += ' data-type="frame"';
    if (node.name !== defaultName(node.type)) attrs += ` data-name="${escapeHTML(node.name)}"`;
    return attrs;
}

export function toReact(doc: Doc, rootId: string | null): string {
    const root = rootId ? doc.get(rootId) : undefined;
    const lines = [`export function ${componentName(root?.name ?? 'Canvas')}() {`, '  return ('];
    const draw = (node: Node, indent: number, relative = false) => {
        if (node.type === 'page') { for (const child of children(doc, node.id)) draw(child, indent); return; }
        const pad = ' '.repeat(indent);
        lines.push(`${pad}<div${attributes(node)}`, `${pad}  style={{`);
        for (const [key, value] of Object.entries(nodeStyle(node, relative))) lines.push(`${pad}    ${key}: ${typeof value === 'string' ? quote(value) : value},`);
        const nested = children(doc, node.id);
        lines.push(`${pad}  }}${nested.length ? '>' : ' />'}`);
        if (nested.length) {
            for (const child of nested) draw(child, indent + 2);
            lines.push(`${pad}</div>`);
        }
    };
    if (root) draw(root, 4, root.type === 'frame');
    else {
        lines.push('    <>');
        for (const node of children(doc, null)) draw(node, 6);
        lines.push('    </>');
    }
    lines.push('  );', '}', '');
    return lines.join('\n');
}

export function toHTML(doc: Doc, rootId: string | null): string {
    const root = rootId ? doc.get(rootId) : undefined;
    const lines = ['<!doctype html>', '<html lang="en">', '<head>', '  <meta charset="UTF-8">', '  <meta name="viewport" content="width=device-width, initial-scale=1">', `  <title>${escapeHTML(root?.name ?? 'Canvas')}</title>`, '  <style>body { margin: 0; position: relative; min-height: 100vh; }</style>', '</head>', '<body>'];
    const draw = (node: Node, indent: number, relative = false) => {
        if (node.type === 'page') { for (const child of children(doc, node.id)) draw(child, indent); return; }
        const pad = ' '.repeat(indent);
        const css = Object.entries(nodeStyle(node, relative)).map(([key, value]) => `${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}: ${typeof value === 'number' && key !== 'opacity' ? value + 'px' : value}`).join('; ');
        lines.push(`${pad}<div${attributes(node)} style="${escapeHTML(css)}">`);
        for (const child of children(doc, node.id)) draw(child, indent + 2);
        lines.push(`${pad}</div>`);
    };
    if (root) draw(root, 2, root.type === 'frame');
    else for (const node of children(doc, null)) draw(node, 2);
    lines.push('</body>', '</html>', '');
    return lines.join('\n');
}
