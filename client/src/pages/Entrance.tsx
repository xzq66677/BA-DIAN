/**
 * V5.0 电影感入口（游客态）。
 *
 * 设计意图：视觉层是一套自包含的 HTML/Three.js 原型（public/entrance/），
 * 通过同源 iframe 承载，零改原型内部；本组件只做两件事：
 *   1. 在原型加载完成后挂桥：拦截「创建房间 / 加入房间 / 确认出战」，
 *      把选中的角色 ID 通过 postMessage 交给宿主；
 *   2. 收到消息后用真实网络接口建/入房间，再交给 App 的 enterSession 进入真实对局。
 * 经典入口（?entrance=classic）与原型探索（?proto=A|B|C）均保留。
 *
 * 房间设置（昵称 / 本机人数 / AI 数量 / 天气）在宿主侧完成，与经典入口 Home 对齐：
 * 昵称必填且会记住，避免所有游客都用默认名导致「所有人是同一个人」。
 */
import { useEffect, useRef, useState } from 'react';
import { net } from '../net.js';
import { MAX_ROOM_SEATS } from '../../../shared/src/room-limits.js';
import { defaultName, resolveName, buildLocalNames } from '../entrance-identity.js';
import '../entrance.css';

interface EnterIdentity { playerId: string; name: string; token: string; }
interface RoomResult {
  ok: boolean;
  code?: string;
  seats?: EnterIdentity[];
  error?: string;
  activeCode?: string;
}
interface BridgePayload {
  __entrance?: number;
  type?: string;
  mode?: 'create' | 'join';
  code?: string;
  charId?: string;
  weather?: boolean;
}
interface FlowState { sel?: string; phase?: string; }

const ENTRANCE_SRC = (() => {
  const stage = new URLSearchParams(window.location.search).get('stage');
  return 'entrance/prototypes/v5-entrance.html' + (stage ? '?stage=' + encodeURIComponent(stage) : '');
})();

interface PendingRoom {
  mode: 'create' | 'join';
  proceed: (weather: boolean) => void;
}
interface RoomConfig {
  name: string;
  localCount: number;
  aiCount: number;
}

export default function Entrance({ onEnter }: { onEnter: (code: string, identities: EnterIdentity[]) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [weather, setWeather] = useState(true);
  const [pending, setPending] = useState<PendingRoom | null>(null);

  // 房间配置：与经典入口 Home 的 name / localCount / aiCount 对齐
  const [name, setName] = useState(() => (localStorage.getItem('badian-name') || '').trim() || defaultName());
  const [localCount, setLocalCount] = useState(1);
  const [aiCount, setAiCount] = useState(0);
  // ref：让 onMessage 与桥接闭包始终读到最新配置（useEffect 只挂一次，不能依赖 state 闭包）
  const cfgRef = useRef<RoomConfig>({ name, localCount, aiCount });
  cfgRef.current = { name, localCount, aiCount };

  // 本机玩家 + AI 共用房间席位，合计不得超过服务端上限；改一项时自动收紧另一项的可选范围。
  const maxAi = MAX_ROOM_SEATS - localCount;
  const changeLocalCount = (n: number) => {
    setLocalCount(n);
    setAiCount((prev) => Math.min(prev, MAX_ROOM_SEATS - n));
  };

  // 宿主：接收原型的「确认出战」消息 → 真实建/入房间 → 进入真实对局
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const d = (e.data || {}) as BridgePayload;
      if (d.__entrance !== 1 || d.type !== 'enter') return;
      // 只接受同源消息（iframe 与宿主同源）。注意：iframe.contentWindow 的 WindowProxy
      // 引用在跨 realm 比较时不稳定，故用 origin 校验，不用 e.source 引用相等。
      if (e.origin !== window.location.origin) return;
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError('');
      void (async () => {
        try {
          await net.connect();
          const cfg = cfgRef.current;
          const finalName = resolveName(cfg.name);
          localStorage.setItem('badian-name', finalName);
          const charId = d.charId || 'default';
          const code = String(d.code || '').trim().toUpperCase();
          let raw: unknown;
          if (d.mode === 'join') {
            raw = await net.joinRoom(code, finalName, charId);
          } else {
            // 单设备多人：与经典入口一致，按本机人数生成「名字1/名字2/…」的本地身份
            const localNames = buildLocalNames(finalName, cfg.localCount);
            raw = await net.createRoom(finalName, localNames, charId, {
              id: 'floating-ruins',
              mechanics: { weather: d.weather !== false },
            });
          }
          const r = raw as RoomResult;
          if (!r.ok || !r.code || !r.seats?.length) {
            setError(r.activeCode
              ? `你已在房间 ${r.activeCode}，请用经典入口返回该房间`
              : (r.error || '进入房间失败'));
            busyRef.current = false;
            setBusy(false);
            return;
          }
          // 创建房间后按配置补 AI（经典入口「单人开局(+AI)」等价能力），失败不阻断进房
          if (d.mode !== 'join' && cfg.aiCount > 0 && r.seats[0]) {
            try {
              const host = r.seats[0];
              await net.addAI(r.code, host.playerId, host.token, cfg.aiCount);
            } catch { /* 进房后再由房主在 lobby 手动加，不阻断 */ }
          }
          // 加入房间：本机只持有自己那一个座位（最后一个）；创建房间：本机持有全部本地座位
          const mine = d.mode === 'join' ? r.seats[r.seats.length - 1] : null;
          const identities = mine ? [mine] : r.seats;
          onEnterRef.current(r.code, identities.map((s) => ({ playerId: s.playerId, name: s.name, token: s.token })));
        } catch (err) {
          setError(String(err));
          busyRef.current = false;
          setBusy(false);
        }
      })();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 原型加载完成后挂桥（同源访问 contentWindow，不改原型文件本身）
  const onFrameLoad = () => {
    const w = frameRef.current?.contentWindow as (Window & { __flow?: { state(): FlowState } }) | null;
    if (!w) return;
    let tries = 0;
    const hook = () => {
      const flow = w.__flow;
      const doc = w.document;
      // iframe 内的按钮元素：跨 window 访问，用结构化断言避开 lib.dom 的 GlobalEventHandlers 交叉
      const el = (id: string): (HTMLElement & { onclick: (() => unknown) | null }) | null => {
        const node = doc ? doc.getElementById(id) : null;
        return node ? (node as unknown as HTMLElement & { onclick: (() => unknown) | null }) : null;
      };
      const create = el('createBtn'), join = el('joinBtn'), confirm = el('confirmBtn');
      if (!flow || !create || !join || !confirm) {
        if (tries++ < 50) window.setTimeout(hook, 100);
        return;
      }
      let mode: 'create' | 'join' = 'create';
      let code = '';
      const origCreate = create.onclick, origJoin = join.onclick, origConfirm = confirm.onclick;
      create.onclick = function () { mode = 'create'; code = ''; if (origCreate) origCreate.call(this); };
      join.onclick = function () {
        const input = w.prompt('输入房间邀请码', '') || '';
        if (!input.trim()) return;
        code = input;
        mode = 'join';
        if (origJoin) origJoin.call(this);
      };
      confirm.onclick = function () {
        const button = this;
        const proceed = (selectedWeather: boolean) => {
          if (origConfirm) origConfirm.call(button);
          const st = flow.state();
          // 等转场动画播完再切到真实房间，避免观感割裂
          window.setTimeout(() => {
            w.parent.postMessage({
              __entrance: 1,
              type: 'enter',
              mode,
              code,
              charId: st.sel || 'default',
              weather: selectedWeather,
            }, window.location.origin);
          }, 900);
        };
        // 创建与加入都先弹宿主设置框（填昵称等），确认后再走真实网络
        setPending({ mode, proceed });
      };
    };
    hook();
  };

  const confirmPending = () => {
    if (!pending) return;
    const finalName = name.trim();
    if (!finalName) { setError('请先填写昵称'); return; }
    // 二次校验：即使 UI 选项被绕开，也不把注定被服务端拒绝的组合发出去。
    if (pending.mode === 'create' && localCount + aiCount > MAX_ROOM_SEATS) {
      setError(`房间最多 ${MAX_ROOM_SEATS} 人，请减少本机玩家或 AI 数量`);
      return;
    }
    setName(finalName);
    localStorage.setItem('badian-name', finalName);
    setError('');
    const next = pending.proceed;
    setPending(null);
    next(weather);
  };

  return (
    <div className="entrance-shell">
      <iframe
        ref={frameRef}
        className="entrance-frame"
        src={ENTRANCE_SRC}
        onLoad={onFrameLoad}
        title="BA·DIAN 入口"
        allow="autoplay"
      />
      <a className="entrance-classic" href="?entrance=classic" title="返回原有入口">经典入口</a>
      {pending && (
        <div className="entrance-settings-backdrop">
          <section className="entrance-settings" role="dialog" aria-modal="true" aria-labelledby="room-settings-title">
            <p className="entrance-settings-kicker">ROOM SETTINGS · 悬浮遗迹</p>
            <h2 id="room-settings-title">{pending.mode === 'create' ? '创建房间' : '加入房间'}</h2>
            <label className="entrance-field">
              <span>昵称（必填，本设备会记住）</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} placeholder="输入昵称" />
            </label>
            {pending.mode === 'create' && (
              <>
                <div className="entrance-field-row">
                  <label className="entrance-field">
                    <span>本机玩家数</span>
                    <select value={localCount} onChange={(e) => changeLocalCount(Number(e.target.value))}>
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} 人</option>)}
                    </select>
                  </label>
                  <label className="entrance-field">
                    <span>AI 数量</span>
                    <select value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
                      {Array.from({ length: maxAi + 1 }, (_, i) => i).map((n) => <option key={n} value={n}>{n} 个</option>)}
                    </select>
                  </label>
                </div>
                <p className="entrance-cap-hint">共 {localCount + aiCount} / {MAX_ROOM_SEATS} 人（房间上限 {MAX_ROOM_SEATS} 人）</p>
                <fieldset>
                  <legend>天气与泥潭（悬浮遗迹）</legend>
                  <label><input type="radio" name="entrance-weather" checked={weather} onChange={() => setWeather(true)} /> 开启</label>
                  <label><input type="radio" name="entrance-weather" checked={!weather} onChange={() => setWeather(false)} /> 关闭</label>
                </fieldset>
              </>
            )}
            <div className="entrance-settings-actions">
              <button type="button" onClick={() => setPending(null)}>返回选角</button>
              <button type="button" onClick={confirmPending}>{pending.mode === 'create' ? '创建房间' : '加入房间'}</button>
            </div>
          </section>
        </div>
      )}
      {busy && <div className="entrance-toast">正在进入房间…</div>}
      {error && (
        <div className="entrance-error">
          <span>{error}</span>
          <a href="?entrance=classic">切到经典入口</a>
        </div>
      )}
    </div>
  );
}
