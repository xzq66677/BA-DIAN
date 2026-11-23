import { request } from 'node:http';
import type { Page, Route } from 'playwright';
import WebSocket from 'ws';
import type { TestServer } from './test-server.js';

/** Keep the browser, built application and server real while carrying traffic in process. */
export async function attachBrowserTransport(page: Page, server: TestServer): Promise<void> {
  const { agent, url } = server;
  if (!agent) return;

  await page.route((target) => target.origin === url, async (route: Route) => {
    const input = route.request();
    const response = await new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
      const upstream = request(input.url(), {
        agent, method: input.method(), headers: input.headers(),
      }, (message) => {
        const chunks: Buffer[] = [];
        message.on('error', reject);
        message.on('data', (chunk: Buffer) => chunks.push(chunk));
        message.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(message.headers)) {
            if (value !== undefined && key !== 'connection' && key !== 'transfer-encoding') {
              headers[key] = Array.isArray(value) ? value.join('\n') : value;
            }
          }
          resolve({ status: message.statusCode ?? 500, headers, body: Buffer.concat(chunks) });
        });
      });
      upstream.on('error', reject);
      upstream.end(input.postDataBuffer() ?? undefined);
    });
    await route.fulfill(response);
  });

  const wsOrigin = url.replace('http:', 'ws:');
  await page.routeWebSocket((target) => target.origin === wsOrigin, (route) => {
    const socket = new WebSocket(route.url(), { agent });
    socket.on('message', (data, binary) => {
      const message = Array.isArray(data) ? Buffer.concat(data)
        : Buffer.isBuffer(data) ? data : Buffer.from(data);
      route.send(binary ? message : message.toString());
    });
    socket.on('close', (code, reason) => route.close({
      code: code === 1005 ? 1000 : code === 1006 ? 1011 : code,
      reason: reason.toString(),
    }));
    socket.on('error', () => route.close({ code: 1011, reason: 'Test WebSocket bridge error' }));
    route.onMessage((message) => socket.send(message));
    route.onClose(() => socket.close());
  });
}
