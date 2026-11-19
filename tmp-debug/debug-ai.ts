import { io as ioClient } from 'socket.io-client';

async function main() {
  const mod = await import('../server/src/index.js');
  const httpServer = (mod as any).httpServer;
  (mod as any).startServer(0);
  await new Promise<void>((r) => httpServer.once('listening', r));
  const serverUrl = `http://127.0.0.1:${httpServer.address().port}`;

  const s = ioClient(serverUrl, { transports: ['websocket'] });
  await new Promise<void>((res) => s.on('connect', res));
  const emit = <T,>(ev: string, data: unknown): Promise<T> => new Promise((res) => s.emit(ev, data, (r: T) => res(r)));

  const createRes: any = await emit('room:create', { name: '勇者' });
  const code = createRes.code;
  const me = createRes.seats[0];
  await emit('room:addAI', { code, playerId: me.playerId, token: me.token, count: 2 });
  const startRes: any = await emit('room:start', { code, playerId: me.playerId, token: me.token, seed: 777 });
  console.log('start', startRes);

  let updates = 0;
  let lastRound = 0;
  s.on('room:update', (u: any) => {
    updates++;
    const g = u.game;
    if (!g) return;
    if (g.roundNo !== lastRound) { lastRound = g.roundNo; }
    if (g.phase === 'rps1') {
      const th = ['rock','scissors','paper'][updates % 3];
      s.emit('game:throw', { code, playerId: me.playerId, token: me.token, throw: th }, (r: any) => {
        if (!r.ok) console.log('throw rejected:', r.error);
      });
    } else if (g.phase === 'act') {
      if (g.currentActor === me.playerId) {
        const meP = g.players.find((p: any) => p.id === me.playerId);
        const sameRoom = g.players.filter((p: any) => p.alive && p.id !== me.playerId && p.room === meP.room && !p.hidden);
        const others = g.players.filter((p: any) => p.alive && p.id !== me.playerId);
        const action = sameRoom.length ? { type: 'attack', targetId: sameRoom[0].id } : (others.length ? { type: 'move', room: others[0].room } : { type: 'skip' });
        s.emit('game:action', { code, playerId: me.playerId, token: me.token, action }, (r: any) => {
          if (!r.ok) console.log('action rejected:', JSON.stringify(action), r.error);
        });
      }
    }
    if (updates % 50 === 0) console.log('updates:', updates, 'round:', g.roundNo, 'phase:', g.phase, 'alive:', g.aliveCount);
  });

  s.on('game:over', (r: any) => {
    console.log('GAME OVER after', updates, 'updates. winner:', r.winner);
    process.exit(0);
  });

  setTimeout(() => { console.log('TIMEOUT. updates:', updates, 'round:', lastRound); process.exit(1); }, 15000);
}
main().catch(e => { console.error(e); process.exit(1); });
