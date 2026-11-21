/**
 * 拔典 · 轻量原创音效（WebAudio 合成，无外部资源）
 *
 * 设计约束（任务书 §10）：
 *  - 全部音效由振荡器/噪声实时合成，零素材依赖、零网络加载、零许可风险；
 *  - 与真实结构化事件绑定（在演出队列的事件入口触发），不由客户端猜测结果；
 *  - 拥堵（fast 模式）下只保留重大事件音效，避免堆积；
 *  - 静音开关持久化（localStorage），默认开启但音量克制（≈0.22）；
 *  - AudioContext 在首次用户手势后创建/恢复（浏览器自动播放策略）；
 *  - 环境无 WebAudio（jsdom/旧浏览器）时全部静默，不抛错。
 */

export type SfxKind =
  | 'hit'        // 受击（斩击落下）
  | 'heal'       // 回复
  | 'move'       // 移动
  | 'eliminate'  // 淘汰
  | 'revive'     // 复活
  | 'throw'      // 大伊万投掷（飞行启动）
  | 'boom'       // 大伊万爆炸 / AOE 房间告警
  | 'decl'       // 攻击宣告（出手意向）
  | 'victory';   // 终局胜利（平局不播）

const VOL_KEY = 'badian-sfx-muted';
const MASTER_GAIN = 0.22;

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  /** 当前并发音源数（防拥堵堆积） */
  private active = 0;
  private lastPlay = new Map<string, number>();

  constructor() {
    try {
      this.muted = typeof localStorage !== 'undefined' && localStorage.getItem(VOL_KEY) === '1';
    } catch { /* ignore */ }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      if (m) localStorage.setItem(VOL_KEY, '1');
      else localStorage.removeItem(VOL_KEY);
    } catch { /* ignore */ }
  }

  /** 用户手势后调用：创建/恢复 AudioContext（幂等） */
  ensure(): void {
    if (this.muted) return;
    try {
      if (!this.ctx) {
        const AC = (typeof window !== 'undefined'
          ? (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined);
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.master.connect(this.ctx.destination);
        // 0.5s 白噪声缓冲（受击/爆炸/移动共用）
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch { /* 环境不支持：静默 */ }
  }

  /**
   * 播放一个音效。同类音效 80ms 内去重；每个音效持续时间 ≤0.75s。
   * @param kind 音效类型
   * @param major 拥堵模式下是否仍播放（重大事件= true）
   */
  play(kind: SfxKind, opts: { major?: boolean; congestion?: boolean; reduced?: boolean } = {}): void {
    if (this.muted) return;
    if (opts.congestion && !opts.major) return; // 拥堵压缩：只留重大事件
    if (opts.reduced && kind !== 'boom' && kind !== 'eliminate' && kind !== 'victory') return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = this.lastPlay.get(kind) ?? 0;
    if (now - last < 80) return;
    this.lastPlay.set(kind, now);
    this.ensure();
    if (!this.ctx || !this.master) return;
    // 防堆积：并发音源上限
    if (this.active > 24) return;
    this.active++;
    setTimeout(() => { this.active = Math.max(0, this.active - 1); }, 800);
    try {
      const t = this.ctx.currentTime;
      switch (kind) {
        case 'hit': this.hit(t); break;
        case 'heal': this.tone(t, 520, 784, 0.28, 'sine', 0.5); break;
        case 'move': this.whoosh(t); break;
        case 'eliminate': this.fall(t); break;
        case 'revive': this.arp(t, [523, 659, 784], 0.11); break;
        case 'throw': this.tone(t, 880, 1245, 0.12, 'triangle', 0.45); break;
        case 'boom': this.boom(t); break;
        case 'decl': this.tone(t, 300, 340, 0.06, 'square', 0.18); break;
        case 'victory': this.arp(t, [523, 659, 784, 1047], 0.15, 0.9); break;
      }
    } catch { /* 播放失败静默 */ }
  }

  /** 短音（频率起止 + 时长） */
  private tone(t: number, f0: number, f1: number, dur: number, type: OscillatorType, peak = 0.5): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** 噪声脉冲（受击/爆炸主体） */
  private noise(t: number, dur: number, freq: number, peak = 0.5): void {
    const ctx = this.ctx!;
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** 受击：噪声斩击 + 低频落点 */
  private hit(t: number): void {
    this.noise(t, 0.09, 5200, 0.55);
    this.tone(t, 140, 70, 0.14, 'sine', 0.6);
  }

  /** 移动：带通噪声扫频（whoosh） */
  private whoosh(t: number): void {
    const ctx = this.ctx!;
    if (!this.noiseBuf) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(400, t);
    filter.frequency.exponentialRampToValueAtTime(1600, t + 0.2);
    filter.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    src.connect(filter).connect(g).connect(this.master!);
    src.start(t);
    src.stop(t + 0.3);
  }

  /** 淘汰：下滑音 */
  private fall(t: number): void {
    this.tone(t, 220, 52, 0.42, 'sawtooth', 0.35);
    this.noise(t, 0.16, 900, 0.3);
  }

  /** 爆炸：低频轰 + 宽噪声 */
  private boom(t: number): void {
    this.tone(t, 90, 34, 0.5, 'sine', 0.85);
    this.noise(t, 0.4, 1400, 0.7);
  }

  /** 琶音（复活/胜利） */
  private arp(t: number, notes: number[], step: number, vol = 0.5): void {
    notes.forEach((f, i) => this.tone(t + i * step, f, f, step * 2.4, 'triangle', vol));
  }
}

export const sfx = new SfxEngine();
