import { isTextNode, type Doc, type Node } from '../shared/doc';
import { aabb as aabbWithSize, nodeHandles as handlesWithSize, worldMatrix as matrixWithSize, worldCorners as cornersWithSize, hit as hitWithSize, world as worldWithSize, type Point } from '../shared/geometry';
import { measureTextNode } from './text-layout';

export const sizeOf = (node: Node) => isTextNode(node) ? measureTextNode(node) : node;
export const world = (doc: Doc, node: Node) => worldWithSize(doc, node, sizeOf);
export const worldMatrix = (doc: Doc, node: Node) => matrixWithSize(doc, node, sizeOf);
export const worldCorners = (doc: Doc, node: Node) => cornersWithSize(doc, node, sizeOf);
export const aabb = (doc: Doc, node: Node) => aabbWithSize(doc, node, sizeOf);
export const nodeHandles = (doc: Doc, node: Node) => handlesWithSize(doc, node, sizeOf);
export const hit = (doc: Doc, point: Point, tol?: number, parent: string | null = null) => hitWithSize(doc, point, parent, sizeOf, tol);
