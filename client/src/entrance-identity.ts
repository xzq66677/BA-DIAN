/**
 * 入口身份构造的纯逻辑（无 React / CSS / 网络依赖，便于独立测试）。
 *
 * 背景：V5.0 电影感入口曾把昵称写死为 localStorage 值或默认「棋手」，
 * 导致所有游客进游戏后都叫同一个名字。这些函数把昵称解析与本地身份拆分
 * 与经典入口 Home 对齐，并可作为回归测试的稳定入口。
 */

/** 本地未设置过昵称时给一个带随机后缀的默认名，避免所有人同名「棋手」 */
export function defaultName(random: number = Math.random()): string {
  return `棋手${Math.floor(1000 + random * 9000)}`;
}

/** 解析并规范化昵称：trim 后为空则回退到默认名 */
export function resolveName(raw: string | null | undefined, random: number = Math.random()): string {
  return (raw || '').trim() || defaultName(random);
}

/**
 * 按本机人数生成本地身份昵称（与经典入口 Home 一致）：
 * 1 人时直接用昵称；多人时追加 1/2/3… 序号，彼此不同。
 */
export function buildLocalNames(name: string, localCount: number): string[] {
  const count = Math.max(1, Math.floor(localCount) || 1);
  return Array.from({ length: count }, (_, i) => (count <= 1 ? name : `${name}${i + 1}`));
}
