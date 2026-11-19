import { CHARACTERS } from '../shared/src/characters/index.js';
import { makeGame, playThrows } from '../shared/src/testcases/helpers.js';

const cd = CHARACTERS['hero-today'];
console.log('actions:', cd.actions?.map(a => a.name));
const g = makeGame([{ id: 'A', char: 'hero-today' }, 'B'], 7);
console.log('game charDef actions:', g.charDef('A').actions?.map(a => a.name));
playThrows(g, [{ A: 'rock', B: 'scissors' }]);
const r = g.submitAction('A', { type: 'rollFortune' } as any);
console.log('rollFortune:', r.ok, r.error ?? '');
console.log('A hp:', g.players['A'].hp, 'alive:', g.players['A'].alive, 'winner:', g.winner, 'phase:', g.phase);
const g2 = makeGame(['A', 'B'], 128);
g2.players['A'].hp = 2;
playThrows(g2, [{ A: 'rock', B: 'scissors' }]);
const r2 = g2.submitAction('A', { type: 'milk' } as any);
console.log('milk:', r2.ok, r2.error ?? '');
