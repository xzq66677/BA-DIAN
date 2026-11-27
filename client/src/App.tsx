import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import Home from './pages/Home.js';
import Entrance from './pages/Entrance.js';
import Lobby from './pages/Lobby.js';
import { net, type AnnounceItem, type LobbyState, type GameSnapshot } from './net.js';
import { mergeAnnouncements } from '../../shared/src/announce.js';

const GamePage = lazy(() => import('./pages/Game.js'));
const Arena = lazy(() => import('./pages/Arena.js'));
const PrototypePage = lazy(() => import('./proto/Prototype.js'));
const pageLoading = <p role="status">正在加载战场…</p>;

export type Page = 'home' | 'lobby' | 'game' | 'arena';

export interface SessionInfo {
  code: string;
  /** 本设备的全部身份（单设备多人） */
  identities: { playerId: string; name: string; token: string }[];
}

let logsSeq = 0;

export default function App() {
  const [page, setPage] = useState<Page>('home');
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [logs, setLogs] = useState<{ seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[]>([]);
  /** 全局播报（服务端权威，增量累积；新局/换房清空） */
  const [announces, setAnnounces] = useState<AnnounceItem[]>([]);
  const [resync, setResync] = useState<{ cursor: number }>();
  const [err, setErr] = useState('');
  /** 已渲染的局号（新开一局要清空上一局的战斗日志） */
  const gameNoRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const off = net.onUpdate((u) => {
      if (u.catchUp) setResync({ cursor: Math.max(0, ...u.newLogs.map(l => l.seq)) });
      setLobby(u.lobby);
      setGame(u.game);
      // 局号变化 = 同一房间开新一局：丢弃上一局日志（服务端 seq 已跨局续接，
      // 若不清理会看到两局日志首尾相接，且 [R1] 之类回合号重复，容易误以为「日志不再更新」）
      const gNo = u.lobby.gameNo ?? null;
      const newGame = gNo !== null && gameNoRef.current !== null && gNo !== gameNoRef.current;
      if (gNo !== null) gameNoRef.current = gNo;
      if (newGame) { setLogs([]); setAnnounces([]); }
      if (u.newLogs && u.newLogs.length > 0) {
        setLogs((prev) => {
          const have = new Set(prev.map((l) => l.seq));
          const add = u.newLogs.filter((l) => !have.has(l.seq)).map((l) => ({ seq: l.seq, text: `[R${l.round}] ${l.text}`, important: l.important === true, type: l.type, data: l.data }));
          if (add.length === 0) return prev;
          const merged = [...prev, ...add];
          return merged.slice(-800);
        });
      }
      // 全局播报：与日志同批增量；seq 去重、保序、保留最近 200 条（广播层已限 80/批）
      if (u.announces && u.announces.length > 0) {
        setAnnounces((prev) => mergeAnnouncements(newGame ? [] : prev, u.announces ?? []));
      }
      // 状态机：lobby → playing 时进入游戏页；over 时留在游戏页显示结果
      setPage((p) => {
        if (u.lobby.state === 'playing' || u.lobby.state === 'over') return p === 'arena' ? p : 'game';
        if (u.lobby.state === 'lobby') return p === 'arena' ? p : 'lobby';
        return p;
      });
    });
    void net.connect().catch((error) => { if (active) setErr(String(error)); });
    return () => { active = false; off(); };
  }, []);

  // 刷新页面时用主座位凭证恢复同一台设备的席位。
  useEffect(() => {
    let active = true;
    try {
      const raw = localStorage.getItem('badian-session');
      if (!raw) return;
      const saved = JSON.parse(raw) as SessionInfo;
      const main = saved?.identities?.[0];
      if (!saved?.code || !main) return;
      void net.connect().then(async () => {
        if (!active || net.currentCode) return;
        const result = await net.reconnect(saved.code, main.playerId, main.token);
        if (!active || net.currentCode || raw !== localStorage.getItem('badian-session')) return;
        if (result.ok) {
          net.identities = saved.identities;
          net.currentCode = saved.code;
          setSession(saved);
        } else if (result.error === '房间不存在' || result.error === '身份验证失败') {
          localStorage.removeItem('badian-session');
        }
      }).catch(() => {});
    } catch { /* ignore */ }
    return () => { active = false; };
  }, []);

  // 房间解散后回到首页，并忽略其它房间的通知。
  const exitRef = useRef<() => void>(() => {});
  useEffect(() => net.onDissolved((code) => {
    if (net.currentCode && net.currentCode !== code) return;
    setErr(`房间 ${code} 已被房主解散`);
    exitRef.current();
  }), []);

  const enterSession = (code: string, identities: { playerId: string; name: string; token: string }[]) => {
    const s: SessionInfo = { code, identities };
    setResync(undefined);
    setSession(s);
    net.identities = identities;
    net.currentCode = code;
    localStorage.setItem('badian-session', JSON.stringify(s));
    setLogs([]);
    setAnnounces([]);
    gameNoRef.current = null; // 跨房间加入：上一局的局号比较基线一并清掉
    setPage('lobby');
  };

  /**
   * 退出会话：统一出口。先尽力通知服务端退出（服务端会移除本设备的**全部**身份，
   * 房间无真人可继续时默认解散——B-029），再清理本地状态。
   * 所有「退出房间 / 离开房间 / 返回首页」入口都应走到这里，避免残留座位卡死后续加入。
   */
  const exitSession = () => {
    const s = session;
    const l = lobby;
    // 尽力退出（房间可能已被解散/不存在，失败可忽略）；用主身份即可——服务端按整台设备退出
    if (s && s.identities.length > 0) {
      void net.leave(s.code, s.identities[0].playerId, s.identities[0].token).catch(() => {});
    } else if (l) {
      void net.detach().catch(() => {});
    }
    net.currentCode = null;
    net.identities = [];
    localStorage.removeItem('badian-session');
    setSession(null);
    setLobby(null);
    setGame(null);
    setLogs([]);
    setAnnounces([]);
    gameNoRef.current = null;
    setPage('home');
  };
  exitRef.current = exitSession;

  // 原型探索模式（Phase B 设计探索专用）：?proto=A|B|C —— 浏览器内真实引擎对局 + 架构原型
  const protoArch = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('proto') : null;
  if (protoArch === 'A' || protoArch === 'B' || protoArch === 'C') {
    return <Suspense fallback={pageLoading}><PrototypePage arch={protoArch} /></Suspense>;
  }

  if (page === 'arena') {
    return (
      <Suspense fallback={pageLoading}>
        <Arena onBack={() => setPage(session ? (lobby?.state === 'lobby' ? 'lobby' : 'game') : 'home')} />
      </Suspense>
    );
  }

  if (!session || !lobby) {
    // V5.0 电影感入口为默认游客态；?entrance=classic 回退旧入口，?proto=A|B|C 走原型探索
    const classic = typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('entrance') === 'classic';
    if (!classic) return <Entrance onEnter={enterSession} />;
    return (
      <div className="app">
        {err && <div className="error-banner">{err}</div>}
        <Home onEnter={enterSession} onArena={() => setPage('arena')} />
      </div>
    );
  }

  return (
    <div className={lobby.state !== 'lobby' ? 'app app-game' : 'app'}>
      {err && <div className="error-banner">{err}</div>}
      {(page === 'lobby' || lobby.state === 'lobby') && (
        <Lobby
          lobby={lobby}
          session={session}
          onExit={exitSession}
        />
      )}
      {(page === 'game' || lobby.state !== 'lobby') && lobby.state !== 'lobby' && (
        <Suspense fallback={pageLoading}>
          <GamePage
            resync={resync}
            lobby={lobby}
            game={game}
            session={session}
            logs={logs}
            announces={announces}
            onExit={exitSession}
            onBackToLobby={() => setPage('lobby')}
          />
        </Suspense>
      )}
    </div>
  );
}

export { logsSeq };
