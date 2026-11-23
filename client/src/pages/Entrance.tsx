/**
 * V5.0 电影感入口（游客态）。
 *
 * 设计意图：视觉层是一套自包含的 HTML/Three.js 原型（public/entrance/），
 * 通过同源 iframe 承载，零改原型内部；本组件只做两件事：
 *   1. 在原型加载完成后挂桥：拦截「创建房间 / 加入房间 / 确认出战」，
 *      把选中的角色 ID 通过 postMessage 交给宿主；
 *   2. 收到消息后用真实网络接口建/入房间，再交给 App 的 enterSession 进入真实对局。
 * 经典入口（?entrance=classic）与原型探索（?proto=A|B|C）均保留。
 */
import { useEffect, useRef, useState } from 'react';
import { net } from '../net.js';
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
}
interface FlowState { sel?: string; phase?: string; }

const ENTRANCE_SRC = (() => {
  const stage = new URLSearchParams(window.location.search).get('stage');
  return 'entrance/prototypes/v5-entrance.html' + (stage ? '?stage=' + encodeURIComponent(stage) : '');
})();

export default function Entrance({ onEnter }: { onEnter: (code: string, identities: EnterIdentity[]) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onEnterRef = useRef(onEnter);
  onEnterRef.current = onEnter;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
          const name = (localStorage.getItem('badian-name') || '棋手').trim();
          localStorage.setItem('badian-name', name);
          const charId = d.charId || 'default';
          const raw = d.mode === 'join'
            ? await net.joinRoom(String(d.code || '').trim().toUpperCase(), name, charId)
            : await net.createRoom(name, [name], charId);
          const r = raw as unknown as RoomResult;
          if (!r.ok || !r.code || !r.seats?.length) {
            setError(r.activeCode
              ? `你已在房间 ${r.activeCode}，请用经典入口返回该房间`
              : (r.error || '进入房间失败'));
            busyRef.current = false;
            setBusy(false);
            return;
          }
          onEnterRef.current(r.code, r.seats);
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
        if (origConfirm) origConfirm.call(this);
        const st = flow.state();
        // 等转场动画播完再切到真实房间，避免观感割裂
        window.setTimeout(() => {
          w.parent.postMessage({
            __entrance: 1,
            type: 'enter',
            mode,
            code,
            charId: st.sel || 'default',
          }, window.location.origin);
        }, 900);
      };
    };
    hook();
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
