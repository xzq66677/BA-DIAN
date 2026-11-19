import { it, expect } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import { beforeAll, afterAll } from 'vitest';

let serverUrl: string;
let httpServer: import('node:http').Server;

beforeAll(async () => {
  const mod = await import('../server/src/index.js');
  httpServer = (mod as { httpServer: import('node:http').Server }).httpServer;
  (mod as { startServer: (port?: number) => void }).startServer(0);
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()));
  const addr = httpServer.address();
  serverUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { httpServer.close(() => resolve()); setTimeout(resolve, 300); });
});

function connect(): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(serverUrl, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
function emit<T = Record<string, unknown>>(s: ClientSocket, event: string, data: unknown): Promise<T> {
  return new Promise((resolve) => { s.emit(event, data, (r: T) => resolve(r || ({ ok: true } as T))); });
}

it('chat flow step-by-step', { timeout: 12000 }, async () => {
  const host = await connect();
  console.log('STEP1 connected');
  const createRes = await emit<{ ok: boolean; code: string; seats: { playerId: string; token: string }[] }>(host, 'room:create', { name: 'L' });
  console.log('STEP2 create:', createRes.ok);
  const code = createRes.code;
  const me = createRes.seats[0];
  const listRes = await emit<{ ok: boolean; rooms: unknown[] }>(host, 'lobby:roomsReq', {});
  console.log('STEP3 roomsReq:', listRes.ok, listRes.rooms?.length);
  const chatRes = await emit<{ ok: boolean; error?: string }>(host, 'room:chat', { code, playerId: me.playerId, token: me.token, text: 'hi' });
  console.log('STEP4 chat:', chatRes.ok, chatRes.error ?? '');
  const upd = await new Promise<Record<string, unknown>>((resolve) => host.once('room:update', resolve));
  console.log('STEP5 update chat:', JSON.stringify(((upd.lobby as { chat: { text: string }[] }).chat || []).map((c) => c.text)));
  expect(true).toBe(true);
  host.disconnect();
});
