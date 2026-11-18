import type { Comment } from './comments';
import type { Node, Op } from './doc';
import type { Version } from './versions';
export type FeatureClientMsg =
    | { type: 'comment-add'; comment: Comment }
    | { type: 'comment-edit'; id: string; text?: string; resolved?: boolean }
    | { type: 'comment-delete'; id: string }
    | { type: 'version-save'; name: string }
    | { type: 'version-preview'; id: string }
    | { type: 'version-restore'; id: string };
export type FeatureServerMsg =
    | { type: 'comments'; comments: Comment[] }
    | { type: 'versions'; versions: Version[] }
    | { type: 'version-preview'; id: string; nodes: Node[] }
    | { type: 'restored'; ops: Op[] };
