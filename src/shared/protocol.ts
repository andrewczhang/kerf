import type { Node, Op } from './doc';
import type { Point } from './geometry';
export const MAX_OPS = 1000;
export type Role = 'edit' | 'view';
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
    page?: string;
    viewport: {
        x: number;
        y: number;
        zoom: number;
    };
}
export type ClientMsg = FeatureClientMsg | { type: 'share-view' } | {
    type: 'rename';
    name: string;
} | {
    type: 'ping';
} | {
    type: 'ops';
    ops: Op[];
    seq: number;
    epoch?: number;
} | ({
    type: 'presence';
} & Omit<Peer, 'id' | 'color'>);
export type ServerMsg = FeatureServerMsg | { type: 'share-view'; key: string } | { type: 'error'; request: string; message: string } | {
    type: 'name';
    name: string;
} | {
    type: 'pages-state';
    nodes: Node[];
} | {
    type: 'pong';
} | {
    type: 'init';
    name: string;
    ackSeq?: number;
    role: Role;
    nodes: Node[];
    comments: Comment[];
    styles: Style[];
    versions: Version[];
    peers: Peer[];
    you: Peer;
    epoch?: number;
} | {
    type: 'ops';
    ops: Op[];
    from: string;
} | {
    type: 'ack';
    seq: number;
    text?: Op[];
} | {
    type: 'presence';
    peer: Peer;
} | {
    type: 'leave';
    id: string;
};
