import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';

// TC-C070 repro
const g = new Game({ seed: 270, chars: CHARACTERS, players: [
  { id: 'D', name: 'D', charId: 'dajianke', type: 'local' },
  { id: 'A', name: 'A', charId: 'default', type: 'local' },
  { id: 'B', name: 'B', charId: 'default', type: 'local' },
]});
g.players['A'].room = 'R2';
// round1: cycle
for (const [pid, t] of [['A','rock'],['B','scissors'],['D','paper']] as const) g.submitThrow(pid, t as any);
console.log('after r1: phase', g.phase, 'sub', g.subRound);
// round2 (sub 2)
if (g.phase === 'rps1') {
  for (const [pid, t] of [['A','rock'],['B','rock'],['D','scissors']] as const) g.submitThrow(pid, t as any);
}
console.log('after r2: phase', g.phase, 'qualified', g.qualified, 'queue', g.queue);
let guard = 0;
while (g.phase === 'act' && guard++ < 10) {
  const cur = g.currentActor()!;
  const req = cur === 'A' ? { type: 'attack', targetId: 'B' } : { type: 'skip' };
  const r = g.submitAction(cur, req as any);
  console.log('act', cur, JSON.stringify(req), '->', r.ok, r.error ?? '');
  if (!r.ok) break;
}
console.log('D hp:', g.players['D'].hp, 'B hp:', g.players['B'].hp);
const tr = g.logs.filter(l => l.text.includes('吸引'));
console.log('transfer logs:', tr.map(l => l.text));
