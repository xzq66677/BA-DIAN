import { DEFAULT_CONFIG } from './config.js';
import { makeSpec, runMatch, logSequenceHash, replay } from './driver.js';

const cfg = { ...DEFAULT_CONFIG, mapId: 'floatingRuins' as const };
const spec = makeSpec(cfg, ['default', 'bagun', 'gojo', 'mabaoguo'], 12345, 3, {
  hashLogs: true, captureTranscript: true,
});
const a = runMatch(spec);
const b = runMatch(spec);
console.log(JSON.stringify({
  a: {
    end: a.endKind, winner: a.winner, winnerChar: a.winnerChar, rounds: a.rounds,
    steps: a.steps, hash: a.logHash, logs: a.logCount, mechanics: a.mechanics,
    transcriptInputs: a.transcript?.inputs.length,
  },
  sameHash: a.logHash === b.logHash,
  sameWinner: a.winner === b.winner,
}));
if (a.transcript) {
  const g = replay(a.transcript);
  console.log(JSON.stringify({
    replayHash: logSequenceHash(g.logs),
    match: a.logHash === logSequenceHash(g.logs),
    replayOver: g.isOver(), replayWinner: g.winner,
  }));
}
