/**
 * 拔典 · 房间容量约束
 *
 * 服务端权威上限。客户端入口（新 V5 入口 / 经典入口）与服务端 socket 处理器
 * 共用同一份常量，避免出现「界面让选 12 人、服务端却拒绝」的不一致。
 */
export const MAX_ROOM_SEATS = 10;

/** 还可加入的席位数（不会为负），供创建 / 加入 / 添加 AI 三条路径共用 */
export function remainingSeats(current: number): number {
  return Math.max(0, MAX_ROOM_SEATS - current);
}
