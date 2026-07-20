/**
 * Web Audio API による効果音シンセ。外部音源ファイルを使わない。
 * AudioContext はユーザー操作後に初期化する(ブラウザの自動再生制限対応)。
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  private bgmAudio: HTMLAudioElement | null = null;
  private bgmSrc: string | null = null;
  /** 効果音(enabled)とは別に、BGMだけを個別にON/OFFできるようにする */
  bgmEnabled = true;

  /** ユーザー操作イベント内で呼ぶこと */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  /** プレイ中のみBGMをループ再生する(タイトル画面では鳴らさない) */
  playBgm(src: string): void {
    if (this.bgmAudio && this.bgmSrc === src) {
      if (this.bgmEnabled) void this.bgmAudio.play().catch(() => undefined);
      return;
    }
    this.bgmAudio?.pause();
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = 0.32;
    this.bgmAudio = audio;
    this.bgmSrc = src;
    if (this.bgmEnabled) void audio.play().catch(() => undefined);
  }

  /** ゲーム画面を離れるときに呼ぶ */
  stopBgm(): void {
    this.bgmAudio?.pause();
  }

  setBgmEnabled(enabled: boolean): void {
    this.bgmEnabled = enabled;
    if (!this.bgmAudio) return;
    if (enabled) void this.bgmAudio.play().catch(() => undefined);
    else this.bgmAudio.pause();
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private tone(
    freq: number,
    durationMs: number,
    options: {
      type?: OscillatorType;
      gain?: number;
      endFreq?: number;
      delayMs?: number;
    } = {},
  ): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const { type = "sine", gain = 0.15, endFreq, delayMs = 0 } = options;
    const start = this.now() + delayMs / 1000;
    const end = start + durationMs / 1000;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, endFreq), end);
    }
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  private noise(durationMs: number, gain: number, delayMs = 0): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const length = Math.max(1, Math.floor((this.ctx.sampleRate * durationMs) / 1000));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2600;
    src.connect(filter).connect(g).connect(this.master);
    src.start(this.now() + delayMs / 1000);
  }

  keyTap(): void {
    this.tone(1150 + Math.random() * 120, 40, { type: "square", gain: 0.035 });
  }

  keyMiss(): void {
    this.tone(150, 80, { type: "triangle", gain: 0.05 });
  }

  targetLock(): void {
    this.tone(720, 60, { type: "sine", gain: 0.07 });
    this.tone(1080, 70, { type: "sine", gain: 0.05, delayMs: 40 });
  }

  /** 爆発。連鎖が深いほど重く鳴る */
  explosion(chain: number): void {
    const depth = Math.min(chain, 8);
    this.noise(160 + depth * 20, 0.22 + depth * 0.02);
    this.tone(200 + depth * 10, 220, { type: "sine", gain: 0.22, endFreq: 55 });
  }

  /** 連鎖ごとに音程が上がる(設計書 §15) */
  chainStep(chain: number): void {
    const scale = [523, 587, 659, 784, 880, 988, 1175, 1319, 1568, 1760];
    const freq = scale[Math.min(chain - 1, scale.length - 1)] ?? 523;
    this.tone(freq, 180, { type: "triangle", gain: 0.12 });
    this.tone(freq * 1.5, 220, { type: "sine", gain: 0.06, delayMs: 60 });
  }

  riseWarning(): void {
    this.tone(310, 90, { type: "square", gain: 0.05 });
    this.tone(310, 90, { type: "square", gain: 0.05, delayMs: 140 });
  }

  countdownTick(): void {
    this.tone(660, 90, { type: "sine", gain: 0.1 });
  }

  gameStart(): void {
    this.tone(880, 180, { type: "sine", gain: 0.14 });
    this.tone(1320, 240, { type: "sine", gain: 0.1, delayMs: 90 });
  }

  gameFinish(): void {
    this.tone(523, 200, { type: "triangle", gain: 0.12 });
    this.tone(659, 200, { type: "triangle", gain: 0.12, delayMs: 120 });
    this.tone(784, 320, { type: "triangle", gain: 0.12, delayMs: 240 });
  }

  perfect(): void {
    this.tone(1568, 120, { type: "sine", gain: 0.08 });
  }

  /** ゲージ満タン */
  burstReady(): void {
    this.tone(880, 100, { type: "triangle", gain: 0.1 });
    this.tone(1109, 100, { type: "triangle", gain: 0.1, delayMs: 90 });
    this.tone(1319, 200, { type: "triangle", gain: 0.12, delayMs: 180 });
  }

  /** TYPE BURST 発動 */
  burst(): void {
    this.noise(500, 0.34);
    this.tone(90, 600, { type: "sawtooth", gain: 0.26, endFreq: 32 });
    this.tone(1760, 350, { type: "sine", gain: 0.1, endFreq: 440, delayMs: 60 });
  }

  garbageSend(): void {
    this.tone(300, 220, { type: "sawtooth", gain: 0.08, endFreq: 900 });
  }

  garbageLand(): void {
    this.noise(110, 0.16);
    this.tone(140, 150, { type: "sine", gain: 0.16, endFreq: 70 });
  }

  /** 選択キャンセル(ミス音より柔らかく) */
  cancel(): void {
    this.tone(500, 70, { type: "sine", gain: 0.06, endFreq: 320 });
  }

  /** 新しい行が降ってくる */
  rowDrop(): void {
    this.tone(220, 120, { type: "sine", gain: 0.07, endFreq: 120 });
  }

  allClear(): void {
    const notes = [784, 988, 1175, 1568];
    notes.forEach((f, i) => this.tone(f, 200, { type: "triangle", gain: 0.12, delayMs: i * 90 }));
    this.noise(300, 0.1, 360);
  }

  levelUp(): void {
    this.tone(659, 130, { type: "triangle", gain: 0.1 });
    this.tone(880, 200, { type: "triangle", gain: 0.11, delayMs: 110 });
  }

  win(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(f, 260, { type: "triangle", gain: 0.13, delayMs: i * 130 }));
  }

  lose(): void {
    const notes = [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone(f, 300, { type: "triangle", gain: 0.11, delayMs: i * 150 }));
  }
}
