import { useEffect, useRef, useState } from 'react';
import Home from './pages/Home.js';
import Lobby from './pages/Lobby.js';
import GamePage from './pages/Game.js';
import Arena from './pages/Arena.js';
import { net, type LobbyState, type GameSnapshot } from './net.js';

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
  const [err, setErr] = useState('');
  /** 已渲染的局号（新开一局要清空上一局的战斗日志） */
  const gameNoRef = useRef<number | null>(null);

  useEffect(() => {
    let off: (() => void) | undefined;
    net.connect().then(() => {
      off = net.onUpdate((u) => {
        setLobby(u.lobby);
        if (u.game) setGame(u.game);
        // 局号变化 = 同一房间开新一局：丢弃上一局日志（服务端 seq 已跨局续接，
        // 若不清理会看到两局日志首尾相接，且 [R1] 之类回合号重复，容易误以为「日志不再更新」）
        const gNo = u.lobby.gameNo ?? null;
        const newGame = gNo !== null && gameNoRef.current !== null && gNo !== gameNoRef.current;
        if (gNo !== null) gameNoRef.current = gNo;
        if (newGame) setLogs([]);
        if (u.newLogs && u.newLogs.length > 0) {
          setLogs((prev) => {
            const have = new Set(prev.map((l) => l.seq));
            const add = u.newLogs.filter((l) => !have.has(l.seq)).map((l) => ({ seq: l.seq, text: `[R${l.round}] ${l.text}`, important: l.important === true, type: l.type, data: l.data }));
            if (add.length === 0) return prev;
            const merged = [...prev, ...add];
            return merged.slice(-800);
          });
        }
        // 状态机：lobby → playing 时进入游戏页；over 时留在游戏页显示结果
        setPage((p) => {
          if (u.lobby.state === 'playing' || u.lobby.state === 'over') return p === 'arena' ? p : 'game';
          if (u.lobby.state === 'lobby') return p === 'arena' ? p : 'lobby';
          return p;
        });
      });
    }).catch((e) => setErr(String(e)));
    return () => { off?.(); };
  }, []);

  // 恢复会话（localStorage 令牌）
  useEffect(() => {
    try {
      const raw = localStorage.getItem('badian-session');
      if (raw && !session) {
        const s = JSON.parse(raw) as SessionInfo & { lobbyState?: string };
        if (s.code && s.identities?.length) {
          // 异步恢复：逐身份重连（单设备多人恢复主身份即可，其余按需）
          net.connect().then(async () => {
            const main = s.identities[0];
            const r = await net.reconnect(s.code, main.playerId, main.token);
            if (r.ok) {
              setSession(s);
              net.identities = s.identities;
            } else {
              localStorage.removeItem('badian-session');
            }
          }).catch(() => {});
        }
      }
    } catch { /* ignore */ }
  }, [session]);

  // 房间被解散时：提示并回到首页（exitSession 经 ref 引用，避免 effect 闭包过期）
  const exitRef = useRef<() => void>(() => {});
  useEffect(() => {
    const off = net.connect().then(() => net.onDissolved((code) => {
      setErr(`房间 ${code} 已被房主解散`);
      exitRef.current();
    }));
    return () => { off.then((f) => f()).catch(() => {}); };
  }, []);

  const enterSession = (code: string, identities: { playerId: string; name: string; token: string }[]) => {
    const s: SessionInfo = { code, identities };
    setSession(s);
    net.identities = identities;
    net.currentCode = code;
    localStorage.setItem('badian-session', JSON.stringify(s));
    setLogs([]);
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
    localStorage.removeItem('badian-session');
    setSession(null);
    setLobby(null);
    setGame(null);
    setLogs([]);
    gameNoRef.current = null;
    setPage('home');
  };
  exitRef.current = exitSession;

  if (page === 'arena') {
    return <Arena onBack={() => setPage(session ? (lobby?.state === 'lobby' ? 'lobby' : 'game') : 'home')} />;
  }

  if (!session || !lobby) {
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
        <GamePage
          lobby={lobby}
          game={game}
          session={session}
          logs={logs}
          onExit={exitSession}
          onBackToLobby={() => setPage('lobby')}
        />
      )}
    </div>
  );
}

export { logsSeq };
