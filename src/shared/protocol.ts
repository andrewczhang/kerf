import type { Node, Op } from './doc';
import type { Point } from './geometry';
export const MAX_OPS = 1000;
export interface Peer {
    id: string;
    color: string;
    name: string;
    cursor: Point | null;
    selection: string[];
    viewport: {
        x: number;
        y: number;
        zoom: number;
    };
}
export type ClientMsg = {
    type: 'ops';
    ops: Op[];
    seq: number;
} | ({
    type: 'presence';
} & Omit<Peer, 'id' | 'color'>);
export type ServerMsg = {
    type: 'init';
    nodes: Node[];
    peers: Peer[];
    you: Peer;
} | {
    type: 'ops';
    ops: Op[];
    from: string;
} | {
    type: 'ack';
    seq: number;
} | {
    type: 'presence';
    peer: Peer;
} | {
    type: 'leave';
    id: string;
};
