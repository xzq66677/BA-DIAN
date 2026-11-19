import { io as ioClient } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';

async function main() {
  const mod = await import('../server/src/index.js');
  const httpServer = (mod as any).httpServer;
  (mod as any).startServer(0);
  await new Promise<void>((r) => httpServer.once('listening', r));
  const addr = httpServer.address();
  const serverUrl = `http://127.0.0.1:${addr.port}`;
  console.log('server at', serverUrl);

  const connect = (): Promise<ClientSocket> => new Promise((res, rej) => {
    const s = ioClient(serverUrl, { transports: ['websocket'] });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
  const emit = <T,>(s: ClientSocket, ev: string, data: unknown): Promise<T> => new Promise((res) => s.emit(ev, data, (r: T) => res(r)));

  const host = await connect();
  const createRes = await emit<any>(host, 'room:create', { name: '甲' });
  console.log('created:', createRes.ok, createRes.code);
  const guest = await connect();
  const joinRes = await emit<any>(guest, 'room:join', { code: createRes.code, name: '乙' });
  console.log('joined:', joinRes.ok);

  guest.on('room:update', (u: any) => {
    console.log('[guest update] phase:', u.game?.phase, 'submitted:', u.game?.submittedIds?.length, 'logs:', u.newLogs?.length);
  });

  const startRes = await emit<any>(host, 'room:start', { code: createRes.code, playerId: createRes.seats[0].playerId, token: createRes.seats[0].token });
  console.log('start:', startRes);
  await new Promise((r) => setTimeout(r, 300));

  const throwRes = await emit<any>(host, 'game:throw', { code: createRes.code, playerId: createRes.seats[0].playerId, token: createRes.seats[0].token, throw: 'rock' });
  console.log('host throw:', throwRes);
  await new Promise((r) => setTimeout(r, 500));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
