import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { validComment, type Comment } from '../src/shared/comments';
import { applyOp, type Node } from '../src/shared/doc';
import type { StoredDocument } from './document';
import type { FeatureClientMsg, FeatureServerMsg } from '../src/shared/features-protocol';
import { versionDiff, type Version } from '../src/shared/versions';
import type { Peer } from '../src/shared/protocol';
import { validStyle, styleOps, detachOps, type Style } from '../src/shared/styles';
export class Features {
    styles: Style[] = [];
    comments: Comment[] = [];
    versions: Version[] = [];
    constructor(private storage: DurableObjectStorage, private doc: StoredDocument, private broadcast: (m: FeatureServerMsg) => void) {}
    async load() {
        this.styles = await this.storage.get<Style[]>('styles') ?? [];
        this.comments = await this.storage.get<Comment[]>('comments') ?? [];
        this.versions = await this.storage.get<Version[]>('versions') ?? [];
    }
    async save(name: string, author: string, auto: boolean) {
        const v: Version = { id: crypto.randomUUID(), name: name.trim().slice(0, 100) || 'Autosave', at: Date.now(), author, nodeCount: this.doc.size, auto };
        await this.storage.put('version:' + v.id, [...this.doc.values()]);
        this.versions.push(v);
        const autos = this.versions.filter(v => v.auto);
        for (const old of autos.slice(0, Math.max(0, autos.length - 100))) {
            this.versions = this.versions.filter(v => v.id !== old.id);
            await this.storage.delete('version:' + old.id);
        }
        await this.storage.put('versions', this.versions);
        this.broadcast({ type: 'versions', versions: this.versions });
    }
    async changed(author: string) {
        const last = this.versions.at(-1);
        if (!last || Date.now() - last.at >= 600000) await this.save('Autosave', author, true);
    }
    async message(m: FeatureClientMsg, peer: Peer, reply: (m: FeatureServerMsg) => void) {
        if (m.type === 'style-upsert' || m.type === 'style-delete') {
            if (m.type === 'style-upsert' && (!validStyle(m.style) || this.styles.some(s => s.id === m.style.id && s.kind !== m.style.kind))) return;
            const id = m.type === 'style-upsert' ? m.style.id : m.id;
            if (typeof id !== 'string') return;
            const ops = m.type === 'style-upsert' ? styleOps(this.doc, m.style) : detachOps(this.doc, id);
            this.styles = this.styles.filter(s => s.id !== id);
            if (m.type === 'style-upsert') this.styles.push(m.style);
            for (const op of ops) applyOp(this.doc, op);
            await this.doc.persist(this.storage, { styles: this.styles });
            this.broadcast({ type: 'styles', styles: this.styles });
            this.broadcast({ type: 'ops', ops, from: peer.id });
            if (ops.length) await this.changed(peer.name);
            return;
        }
        if (m.type === 'comment-add') {
            const c = { ...m.comment, author: peer.name, color: peer.color, at: Date.now() };
            if (!validComment(c) || this.comments.some(old => old.id === c.id)
                || c.thread !== null && !this.comments.some(old => old.id === c.thread && old.thread === null)) return;
            this.comments.push(c);
        } else if (m.type === 'comment-edit') {
            const c = this.comments.find(c => c.id === m.id);
            if (!c) return;
            const next = { ...c, ...(m.text === undefined ? {} : { text: m.text }), ...(m.resolved === undefined ? {} : { resolved: m.resolved }) };
            if (!validComment(next)) return;
            Object.assign(c, next);
        } else if (m.type === 'comment-delete') {
            this.comments = this.comments.filter(c => c.id !== m.id && c.thread !== m.id);
        } else if (m.type === 'version-save') {
            if (typeof m.name === 'string') await this.save(m.name, peer.name, false);
            return;
        } else if (m.type === 'version-preview' || m.type === 'version-restore') {
            if (!this.versions.some(v => v.id === m.id)) return;
            const nodes = await this.storage.get<Node[]>('version:' + m.id);
            if (!nodes) return;
            if (m.type === 'version-preview') reply({ type: 'version-preview', id: m.id, nodes });
            else {
                await this.save('Before restore', peer.name, true);
                const ops = versionDiff(this.doc, new Map(nodes.map(n => [n.id, n])));
                for (const op of ops) applyOp(this.doc, op);
                await this.doc.persist(this.storage);
                this.broadcast({ type: 'restored', ops });
            }
            return;
        } else return;
        await this.storage.put('comments', this.comments);
        this.broadcast({ type: 'comments', comments: this.comments });
    }
}
