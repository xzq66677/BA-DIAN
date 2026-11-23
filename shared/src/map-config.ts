/** 房间的地图及其机制配置。新增地图时可扩展此联合类型和服务端校验。 */
export interface FloatingRuinsMapConfig {
  id: 'floating-ruins';
  mechanics: { weather: boolean };
}

export type MapConfig = FloatingRuinsMapConfig;

/** 旧客户端未传地图配置时保持原有默认行为；拒绝未知地图和无效选项。 */
export function parseMapConfig(value: unknown): MapConfig {
  if (value === undefined) return { id: 'floating-ruins', mechanics: { weather: true } };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('地图配置无效');
  const map = value as Record<string, unknown>;
  if (map.id !== 'floating-ruins') throw new Error('未知地图');
  if (!map.mechanics || typeof map.mechanics !== 'object' || Array.isArray(map.mechanics)) throw new Error('地图机制配置无效');
  const mechanics = map.mechanics as Record<string, unknown>;
  if (typeof mechanics.weather !== 'boolean' || Object.keys(mechanics).some(key => key !== 'weather')) throw new Error('地图机制配置无效');
  return { id: 'floating-ruins', mechanics: { weather: mechanics.weather } };
}
