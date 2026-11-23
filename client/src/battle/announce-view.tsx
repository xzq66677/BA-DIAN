/**
 * 拔典 · 全局播报视图（横幅 + 抽屉）
 *
 * 独立于游戏页的纯展示组件：只吃 `AnnounceItem`，不依赖网络层/演出队列，
 * 因此可以被单独渲染与测试（tests/ui/announce-ui.test.tsx），也方便以后用在
 * 回放页、观战页、大厅战报等场景。
 *
 * 数据来源：shared/src/announce.ts 的规则表（服务端权威广播）。
 * 新增动作类型不需要改这里 —— 规则表里加一条即可（见 README「全局播报」）。
 */

import { useMemo, useState } from 'react';
import { fmtAnnounceClock, fmtAnnounceTtl, type AnnounceKind } from '../../../shared/src/announce.js';
import type { AnnounceItem } from '../net.js';

/** 每类播报的短标签：让「重要动作」与「胜负回合」在视觉上一眼可区分 */
const KIND_LABEL: Record<AnnounceKind, string> = {
  move: '移动', attack: '战斗', skill: '技能', heal: '回复', hide: '潜行',
  outcome: '战果', round: '回合', system: '系统',
};

/**
 * 战场中央横幅：图标 + 文本 + 服务端时间戳。
 * 停留时长由 `ttlMs` 通过内联 `animationDuration` 控制（CSS 只负责动画曲线与配色）。
 */
export function GlobalAnnounceBanner({ item }: { item: AnnounceItem }) {
  // 老客户端/补发数据可能没有 kind，降级到 system，避免生成 kind-undefined 的无效 class
  const kind = item.kind ?? 'system';
  return (
    <div
      className={`global-announce tone-${item.tone} prio-${item.priority} kind-${kind}`}
      key={item.id}
      data-testid="global-announce"
      data-announce-seq={item.seq}
      data-announce-rule={item.rule}
      data-announce-kind={kind}
      style={{ animationDuration: `${item.ttlMs}ms` }}
    >
      <span className="ga-kind" aria-hidden>{KIND_LABEL[kind]}</span>
      <span className="ga-icon" aria-hidden>{item.icon}</span>
      <span className="ga-text">{item.text}</span>
      <span
        className="ga-time"
        title={`服务端时间 ${fmtAnnounceClock(item.ts)} · 横幅停留 ${fmtAnnounceTtl(item.ttlMs)}`}
      >{fmtAnnounceClock(item.ts)}</span>
    </div>
  );
}

/**
 * 播报抽屉：代替「翻日志」——按时间倒序（最新在上），每行带时间戳与停留时长。
 * 「⭐ 重点」过滤掉 low（阶段提示类），保留战斗/淘汰/奖励等需要抢视线的事件。
 */
export function AnnounceDrawer({ items, onClose }: { items: AnnounceItem[]; onClose: () => void }) {
  const [onlyKey, setOnlyKey] = useState(false);
  const shown = useMemo(() => {
    const list = onlyKey ? items.filter((a) => a.priority !== 'low') : items;
    return [...list].reverse();
  }, [items, onlyKey]);
  return (
    <aside className="announce-drawer" data-testid="announce-drawer" aria-label="全局播报">
      <div className="announce-head">
        <h3>📣 全局播报</h3>
        <div className="btn-row">
          <button
            className={`tcg-btn ${onlyKey ? '' : 'ghost'}`}
            style={{ padding: '3px 9px', fontSize: 11 }}
            onClick={() => setOnlyKey(true)}
          >⭐ 重点</button>
          <button
            className={`tcg-btn ${!onlyKey ? '' : 'ghost'}`}
            style={{ padding: '3px 9px', fontSize: 11 }}
            onClick={() => setOnlyKey(false)}
          >全部</button>
          <button className="tcg-btn ghost" style={{ padding: '3px 9px', fontSize: 11 }} onClick={onClose}>收起</button>
        </div>
      </div>
      <div className="announce-list">
        {shown.length === 0 && (
          <div className="announce-empty">暂无播报 · 开局后每个公开动作都会出现在这里（带时间与反馈时长），不用再翻日志。</div>
        )}
        {shown.map((a) => (
          <div
            key={a.id}
            className={`announce-line tone-${a.tone} prio-${a.priority} kind-${a.kind ?? 'system'}`}
            data-testid="announce-line"
            data-seq={a.seq}
            data-announce-kind={a.kind ?? 'system'}
          >
            <time className="al-time" dateTime={new Date(a.ts).toISOString()}>{fmtAnnounceClock(a.ts)}</time>
            <span className="al-icon" aria-hidden>{a.icon}</span>
            <span className="al-text">{a.text}</span>
            <span className="al-ttl" title="这条播报在战场上停留的时长">{fmtAnnounceTtl(a.ttlMs)}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
