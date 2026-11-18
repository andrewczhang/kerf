import { isTextNode, type Doc, type Node } from '../shared/doc';
import { hit as hitWithSize, world as worldWithSize, type Point } from '../shared/geometry';
import { measureTextNode } from './text-layout';

export const sizeOf = (node: Node) => isTextNode(node) ? measureTextNode(node) : node;
export const world = (doc: Doc, node: Node) => worldWithSize(doc, node, sizeOf);
export const hit = (doc: Doc, point: Point) => hitWithSize(doc, point, null, sizeOf);
