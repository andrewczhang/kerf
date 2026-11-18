import type { Comment } from './comments';
import type { Style } from './styles';
import type { Node, Op } from './doc';
import type { Version } from './versions';
export type FeatureClientMsg =
    | { type: 'style-upsert'; style: Style }
    | { type: 'style-delete'; id: string }
    | { type: 'comment-add'; comment: Comment }
    | { type: 'comment-edit'; id: string; text?: string; resolved?: boolean }
    | { type: 'comment-delete'; id: string }
    | { type: 'version-save'; name: string }
    | { type: 'version-preview'; id: string }
    | { type: 'version-restore'; id: string };
export type FeatureServerMsg =
    | { type: 'styles'; styles: Style[] }
    | { type: 'ops'; ops: Op[]; from: string }
    | { type: 'comments'; comments: Comment[] }
    | { type: 'versions'; versions: Version[] }
    | { type: 'version-preview'; id: string; nodes: Node[] }
    | { type: 'restored'; ops: Op[] };
