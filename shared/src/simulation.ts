import { CHARACTERS } from './characters/index.js';
import type { ActionResult } from './types.js';
import { Game } from './engine.js';
import {
  SIMULATION_VERSION, type MatchInput, type MatchSetup, type MatchTranscript,
} from './simulation-types.js';

const MAX_INPUTS = 20_000;
const MAX_INPUT_CHARACTERS = 2_000_000;

function applyInput(game: Game, input: MatchInput): ActionResult {
  switch (input.kind) {
    case 'throw':
      if (game.phase === 'rps2') return game.submitOrderThrow(input.playerId, input.value);
      if (game.phase === 'judge') return game.submitJudgeThrow(input.playerId, input.value);
      return game.submitThrow(input.playerId, input.value);
    case 'action':
      return game.submitAction(input.playerId, input.action);
    case 'berserk':
      return game.submitBerserk(input.playerId, input.targetId);
    case 'throwTimeout':
      if (game.phase === 'rps1') game.forceFillThrows();
      else if (game.phase === 'rps2') game.forceFillOrderThrows();
      else if (game.phase === 'judge') game.forceFillJudgeThrows();
      else return { ok: false };
      return { ok: true };
    case 'actionTimeout':
      return game.forceSkipAction(input.playerId);
    case 'remove':
      game.removeParticipants(input.ids, input.reason, input.host);
      return { ok: true };
  }
}

export class MatchRecorder {
  readonly transcript: MatchTranscript;
  private lastDrawCount: number;
  private inputCharacters = 0;

  constructor(private readonly game: Game, setup: MatchSetup) {
    this.transcript = { v: SIMULATION_VERSION, setup: structuredClone(setup), inputs: [] };
    this.lastDrawCount = game.rng.drawCount;
  }

  /** Track RNG consumed by AI outside applyInput without rerunning AI policy on replay. */
  apply(input: MatchInput): ActionResult {
    const before = this.game.rng.drawCount;
    const logsBefore = this.game.logs.length;
    const result = applyInput(this.game, input);
    const accepted = result.ok;
    const changed = this.game.rng.drawCount !== before || this.game.logs.length !== logsBefore;
    if (!accepted && !changed) return result;
    if (this.transcript.truncated) return result;
    const inputLength = JSON.stringify(input).length;
    if (this.transcript.inputs.length >= MAX_INPUTS || this.inputCharacters + inputLength > MAX_INPUT_CHARACTERS) {
      this.transcript.truncated = true;
      return result;
    }
    this.transcript.inputs.push({
      input: structuredClone(input), rngAdvance: before - this.lastDrawCount, accepted,
    });
    this.inputCharacters += inputLength;
    this.lastDrawCount = this.game.rng.drawCount;
    return result;
  }
}

/**
 * Rebuild from the initial state. Tick N denotes the state after N recorded inputs.
 * Returns an internal Game for diagnostics. Use snapshot() for public state.
 */
export function replayMatch(transcript: MatchTranscript, toTick?: number): Game {
  if (transcript.v !== SIMULATION_VERSION) throw new Error('Unsupported simulation version');
  if (toTick === undefined && transcript.truncated) throw new Error('Incomplete simulation transcript');
  const tick = toTick ?? transcript.inputs.length;
  if (!Number.isSafeInteger(tick) || tick < 0 || tick > transcript.inputs.length) {
    throw new RangeError('Simulation tick is outside the transcript');
  }
  const game = new Game({ ...structuredClone(transcript.setup), chars: CHARACTERS });
  for (let i = 0; i < tick; i++) {
    const { input, rngAdvance, accepted } = transcript.inputs[i];
    if (!Number.isSafeInteger(rngAdvance) || rngAdvance < 0) {
      throw new Error(`Invalid RNG advance at tick ${i + 1}`);
    }
    game.rng.advance(rngAdvance);
    if (applyInput(game, input).ok !== accepted) throw new Error(`Simulation diverged at tick ${i + 1}`);
  }
  return game;
}
