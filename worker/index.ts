import type { DurableObjectNamespace, Fetcher, Request as WorkerRequest, Response as WorkerResponse } from '@cloudflare/workers-types';
declare const Response: typeof import('@cloudflare/workers-types').Response;
declare const Request: typeof import('@cloudflare/workers-types').Request;
export { Room } from './room';
interface Env {
    ROOM: DurableObjectNamespace;
    ASSETS: Fetcher;
}
export default { async fetch(req: WorkerRequest, env: Env): Promise<WorkerResponse> { const url = new URL(req.url);
    const match = url.pathname.match(/^\/(f|v)\/([\w-]+)\/(?:ws|assets\/[^/]+)$/);
    if (match) {
        const headers = new Headers(req.headers); headers.set('x-kerf-role', match[1] === 'v' ? 'view' : 'edit');
        return env.ROOM.get(env.ROOM.idFromName((match[1] === 'v' ? 'v:' : '') + match[2])).fetch(new Request(req, { headers }));
    }
    if (url.pathname.startsWith('/_internal/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(req); } };
