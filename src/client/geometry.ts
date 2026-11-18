import { isTextNode, type Doc, type Node } from '../shared/doc';
import { aabb as aabbWithSize, nodeHandles as handlesWithSize, worldMatrix as matrixWithSize, worldCorners as cornersWithSize, hit as hitWithSize, world as worldWithSize, type Point } from '../shared/geometry';
import { measureTextNode } from './text-layout';
import { docIndex } from '../shared/doc-index';

export const sizeOf = (node: Node) => isTextNode(node) ? measureTextNode(node) : node;
const worlds = new WeakMap<Doc, { revision: number; nodes: WeakMap<Node, ReturnType<typeof worldWithSize>> }>();
export const world = (doc: Doc, node: Node) => {
    const index = docIndex(doc);
    if (!index) return worldWithSize(doc, node, sizeOf);
    let cache = worlds.get(doc);
    if (!cache || cache.revision !== index.revision) {
        cache = { revision: index.revision, nodes: new WeakMap() }; worlds.set(doc, cache);
    }
    const size = sizeOf(node);
    let r = cache.nodes.get(node);
    if (!r || r.w !== size.w || r.h !== size.h) { r = worldWithSize(doc, node, () => size); cache.nodes.set(node, r); }
    return r;
};
export const worldMatrix = (doc: Doc, node: Node) => matrixWithSize(doc, node, sizeOf);
export const worldCorners = (doc: Doc, node: Node) => cornersWithSize(doc, node, sizeOf);
export const aabb = (doc: Doc, node: Node) => aabbWithSize(doc, node, sizeOf);
export const nodeHandles = (doc: Doc, node: Node) => handlesWithSize(doc, node, sizeOf);
export const hit = (doc: Doc, point: Point, tol?: number, parent: string | null = null) => hitWithSize(doc, point, parent, sizeOf, tol);
