import { isTextNode, type Doc, type Node } from '../shared/doc';
import { hit as hitWithSize, world as worldWithSize, type Point } from '../shared/geometry';
import { measureTextNode } from './text-layout';

const sizeOf = (node: Node) => isTextNode(node) ? measureTextNode(node) : node;
export const world = (doc: Doc, node: Node) => worldWithSize(doc, node, sizeOf);
export const hit = (doc: Doc, point: Point, tol?: number) => hitWithSize(doc, point, null, sizeOf, tol);
