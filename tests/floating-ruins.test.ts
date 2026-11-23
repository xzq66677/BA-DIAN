import { describe, expect, it } from 'vitest';
import { CHARACTERS } from '../shared/src/characters/index.js';
import { Game } from '../shared/src/engine.js';
import { FloatingRuins } from '../shared/src/floating-ruins.js';
import { Room, aiDecideActions } from '../server/src/room.js';

function gameWithRuins(enabled = true, firstCharacter = 'default') {
  return new Game({
    seed: 1,
    chars: CHARACTERS,
    floatingRuins: enabled,
    players: ['A', 'B', 'C'].map(id => ({ id, name: id, charId: id === 'A' ? firstCharacter : 'default', type: 'local' })),
  });
}

function tieUntil(game: Game, round: number) {
  while (game.roundNo < round) {
    for (const id of game.playerIds) expect(game.submitThrow(id, 'rock').ok).toBe(true);
  }
}

function winRound(game: Game, winner: string) {
  for (const id of game.playerIds) expect(game.submitThrow(id, id === winner ? 'rock' : 'scissors').ok).toBe(true);
  expect(game.currentActor()).toBe(winner);
}

describe('悬浮遗迹风雨和导流机关', () => {
  it('天气与泥潭在回合边界推进，同种子可复现且不占用猜拳随机流', () => {
    const game = gameWithRuins();
    const legacy = gameWithRuins(false);
    const forecast = new FloatingRuins(1);
    expect(game.ruinsConditions()?.weather).toBe('clear');
    for (let round = 2; round <= 12; round++) {
      tieUntil(game, round);
      tieUntil(legacy, round);
      forecast.advance(round, game.roomIds);
      expect(game.snapshot().ruins).toEqual(forecast.snapshot());
      expect(game.rng.next()).toBe(legacy.rng.next());
    }
    expect(game.logs.filter(entry => entry.text.includes('预计下一回合形成泥潭')).length).toBeGreaterThan(0);
    expect(legacy.snapshot().ruins).toBeUndefined();
  });

  it('预警可通行，封路只拒绝移入且不消耗行动，下一回合解除', () => {
    const game = gameWithRuins();
    tieUntil(game, 4);
    expect(game.ruinsConditions()?.mud).toEqual({ room: 'R3', activeRound: 5, active: false });
    expect(game.isMoveBlocked('A', 'R3')).toBe(false);
    tieUntil(game, 5);
    winRound(game, 'A');
    expect(game.submitAction('A', { type: 'move', room: 'R3' })).toEqual({ ok: false, error: 'R3 泥潭封路，下回合恢复通行' });
    expect(game.players.A.room).toBe('R1');
    expect(game.stats.A.actions).toBe(0);
    expect(game.currentActor()).toBe('A');
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      expect(aiDecideActions(game, 'A', difficulty)).not.toContainEqual({ type: 'move', room: 'R3' });
    }
    expect(game.submitAction('A', { type: 'skip' }).ok).toBe(true);
    expect(game.ruinsConditions()?.mud).toBeNull();
    winRound(game, 'A');
    expect(game.submitAction('A', { type: 'move', room: 'R3' }).ok).toBe(true);
    expect(game.players.A.room).toBe('R3');
  });

  it('泥潭中的玩家可以撤离，激活后不能再开闸取消泥潭', () => {
    const game = gameWithRuins();
    tieUntil(game, 5);
    winRound(game, 'C');
    expect(game.submitAction('C', { type: 'openSluice' }).ok).toBe(false);
    expect(game.submitAction('C', { type: 'move', room: 'R1' }).ok).toBe(true);
    expect(game.players.C.room).toBe('R1');
  });

  it('泥潭不会阻止大伊万以该房间为技能目标', () => {
    const game = gameWithRuins(true, 'ivan-girl');
    tieUntil(game, 5);
    winRound(game, 'A');
    expect(game.isMoveBlocked('A', 'R3')).toBe(true);
    expect(game.submitAction('A', { type: 'throwIvan', room: 'R3' }).ok).toBe(true);
    expect(game.deferred).toContainEqual(expect.objectContaining({ kind: 'ivan', room: 'R3' }));
  });

  it('只有预警房间的行动者可以开闸，取消预警并正常结束其行动', () => {
    const game = gameWithRuins();
    tieUntil(game, 4);
    winRound(game, 'A');
    expect(game.submitAction('A', { type: 'openSluice', room: 'R3' }).ok).toBe(false);

    const otherGame = gameWithRuins();
    tieUntil(otherGame, 4);
    winRound(otherGame, 'C');
    expect(otherGame.submitAction('C', { type: 'openSluice' }).ok).toBe(true);
    expect(otherGame.roundNo).toBe(5);
    expect(otherGame.stats.C.actions).toBe(1);
    expect(otherGame.ruinsConditions()?.mud).toBeNull();
    expect(otherGame.logs.some(entry => entry.text.includes('泥潭预警解除'))).toBe(true);
  });

  it('房间快照公开天气，重开初始化首轮景况', () => {
    const room = new Room('RUIN', { seed: 1, turnTimeoutMs: 0, submitTimeoutMs: 0 });
    try {
      for (const id of ['A', 'B']) room.addSeat(id, 'default', 'local');
      expect(room.start().ok).toBe(true);
      tieUntil(room.game!, 4);
      const snapshot = room.game!.snapshot();
      expect(snapshot.ruins).toMatchObject({ weather: 'rain' });
      expect(room.restart({ autoStart: true }).ok).toBe(true);
      expect(room.game!.snapshot().ruins).toEqual(new FloatingRuins(1).snapshot());
      expect(snapshot.ruins).toMatchObject({ weather: 'rain' });
    } finally {
      room.dispose();
    }
  });
});
