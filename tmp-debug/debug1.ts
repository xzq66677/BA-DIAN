import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';

// TC-E001 repro: rounds is not iterable
try {
  const g = new Game({ seed: 1, chars: CHARACTERS, players: [
    { id: 'A', name: 'A', charId: 'default', type: 'local' },
    { id: 'B', name: 'B', charId: 'default', type: 'local' },
  ]});
  g.submitThrow('A', 'rock');
  g.submitThrow('B', 'scissors');
  console.log('E001 phase:', g.phase, 'queue:', g.queue, 'judgeRecords:', g.judgeRecords.length);
} catch (e) {
  console.log('E001 ERROR:', (e as Error).stack);
}

// TC-C030 太极 seed probe: find seeds where 太极 wins/loses
for (const seed of [230, 231, 240, 241, 307, 308, 309, 310, 311, 312]) {
  const g = new Game({ seed, chars: CHARACTERS, players: [
    { id: 'A', name: 'A', charId: 'default', type: 'local' },
    { id: 'M', name: 'M', charId: 'mabaoguo', type: 'local' },
  ]});
  g.players['M'].room = 'R1';
  g.submitThrow('A', 'rock'); g.submitThrow('M', 'scissors');
  g.submitAction('A', { type: 'attack', targetId: 'M' });
  const reflected = g.logs.some(l => l.text.includes('太极判定成功'));
  console.log(`seed=${seed} reflected=${reflected} A=${g.players['A'].hp} M=${g.players['M'].hp}`);
}

// TC-C021 step2 repro
{
  const g = new Game({ seed: 221, chars: CHARACTERS, players: [
    { id: 'A', name: 'A', charId: 'gojo', type: 'local' },
    { id: 'B', name: 'B', charId: 'default', type: 'local' },
  ]});
  const play = (throws: any, actions: any) => {
    if (g.phase === 'rps1') { for (const pid of g.aliveIds()) if (throws[pid]) g.submitThrow(pid, throws[pid]); }
    let guard = 0;
    while (g.phase === 'act' && guard++ < 20) {
      const cur = g.currentActor()!;
      const req = actions[cur] || { type: 'skip' };
      const r = g.submitAction(cur, req);
      if (!r.ok) { console.log('  act rejected:', cur, JSON.stringify(req), r.error); break; }
    }
  };
  console.log('--- C021 trace ---');
  play({A:'rock',B:'scissors'}, {A:{type:'attack',targetId:'B',ranged:true}});
  console.log('after r1: hp B =', g.players['B'].hp, 'phase', g.phase);
  play({A:'rock',B:'scissors'}, {A:{type:'aim',targetId:'B'}});
  console.log('after r2: aim =', g.charState('A').aim, 'phase', g.phase);
  play({A:'rock',B:'scissors'}, {A:{type:'attack',targetId:'B',ranged:true}});
  console.log('after r3: hp B =', g.players['B'].hp, 'aim', g.charState('A').aim, 'phase', g.phase);
}
