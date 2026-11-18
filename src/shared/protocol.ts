import type { Node, Op } from './doc';
import type { Point } from './geometry';
export const MAX_OPS = 1000;
import type { FeatureClientMsg, FeatureServerMsg } from './features-protocol';
import type { Comment } from './comments';
import type { Style } from './styles';
import type { Version } from './versions';
export interface Peer {
    id: string;
    color: string;
    name: string;
    cursor: Point | null;
    selection: string[];
    spotlight?: boolean;
    viewport: {
        x: number;
        y: number;
        zoom: number;
    };
}
export type ClientMsg = FeatureClientMsg | {
    type: 'ping';
} | {
    type: 'ops';
    ops: Op[];
    seq: number;
} | ({
    type: 'presence';
} & Omit<Peer, 'id' | 'color'>);
export type ServerMsg = FeatureServerMsg | {
    type: 'pong';
} | {
    type: 'init';
    ackSeq?: number;
    nodes: Node[];
    comments: Comment[];
    styles: Style[];
    versions: Version[];
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
