import type { DurableObjectNamespace, Fetcher, Request, Response as WorkerResponse } from '@cloudflare/workers-types';
declare const Response: typeof import('@cloudflare/workers-types').Response;
export { Room } from './room';
interface Env {
    ROOM: DurableObjectNamespace;
    ASSETS: Fetcher;
}
export default { async fetch(req: Request, env: Env): Promise<WorkerResponse> { const url = new URL(req.url); const match = url.pathname.match(/^\/f\/([\w-]+)\/(?:ws|assets\/[^/]+)$/); if (match)
        return env.ROOM.get(env.ROOM.idFromName(match[1])).fetch(req); return env.ASSETS.fetch(req); } };
