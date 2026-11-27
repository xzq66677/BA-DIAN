import type { SnapPlayer } from '../../../shared/src/protocol.js';

export function slotMachineState(player: Pick<SnapPlayer, 'charId' | 'char'>) {
  if (player.charId !== 'slot-hero') return;
  const machine = player.char.machine as Partial<{
    thrown: boolean;
    landed: boolean;
    room: string | null;
    at: number | null;
    invested: number;
  }> | undefined;
  if (!machine?.thrown || typeof machine.room !== 'string' || !machine.room) return;
  return { room: machine.room, landed: machine.landed === true, at: machine.at, invested: machine.invested };
}

export function slotMachineRoomLabel(machine: NonNullable<ReturnType<typeof slotMachineState>>): string {
  if (machine.landed) return '老虎机已落地';
  return typeof machine.at === 'number' ? `老虎机 · 第 ${machine.at} 回合末落地` : '老虎机即将落地';
}
