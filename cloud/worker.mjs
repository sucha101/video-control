export {VideoQueue} from './queue.mjs';
import {parseRoute} from './web/router.js';

export function authorize(request, env) {
  const path = new URL(request.url).pathname;
  if (path === '/zalo/webhook') {
    const secret = env.ZALO_WEBHOOK_SECRET;
    if (typeof secret !== 'string' || !secret.length) return false;
    const actual = request.headers.get('X-Bot-Api-Secret-Token');
    return actual === secret;
  }
  if (path.startsWith('/api/jobs') || path.startsWith('/api/claim') || path.startsWith('/api/runner/')) {
    const secret = env.RUNNER_TOKEN;
    if (typeof secret !== 'string' || !secret.length) return false;
    const actual = request.headers.get('Authorization');
    return actual === `Bearer ${secret}`;
  }
  // Web API routes (/api/web/*) are authenticated by the Durable Object using session cookies
  if (path.startsWith('/api/web/')) {
    return true;
  }
  return false;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/health' && request.method === 'GET') return Response.json({ok: true, version: 1});

    // Handle API & Webhook routes via Durable Object
    if (path === '/zalo/webhook' || path.startsWith('/api/')) {
      if (!authorize(request, env)) return Response.json({error: 'Unauthorized'}, {status: 401});
      return env.VIDEO_QUEUE.get(env.VIDEO_QUEUE.idFromName('personal-v1')).fetch(request);
    }

    // Handle Static Assets for Web UI
    if (env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return assetResponse;
      // Only known UI routes may use the HTML navigation fallback.
      if ((request.method === 'GET' || request.method === 'HEAD') &&
          request.headers.get('Accept')?.includes('text/html') &&
          parseRoute(url, url.origin).name !== 'notFound') {
        return env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request));
      }
      return assetResponse;
    }

    return Response.json({error: 'Not found'}, {status: 404});
  }
};
