/**
 * Web Audio API による効果音シンセ。外部音源ファイルを使わない。
 * AudioContext はユーザー操作後に初期化する(ブラウザの自動再生制限対応)。
 *
 * D-086で全面的に作り直した。設計方針:
 *  - マスターにリミッター(DynamicsCompressor)を通す。爆発・連鎖・打鍵が同時に
 *    鳴っても歪まず、音量感が揃う。「作り込まれた音」に聞こえる最大の要因。
 *  - 打撃系は「ノイズの立ち上がり(トランジェント) + 音程のある胴体」の2層で作る。
 *    単一のオシレータだけでは輪郭が出ず、爽快感が生まれない。
 *  - 何百回も鳴る音(打鍵)はごく短く・軽く、かつ毎回わずかに高さを散らして
 *    機関銃のような単調さを避ける。
 *  - ミス音は「正解音と絶対に混同しない」ことを最優先する(低い帯域・濁った
 *    2音のうなり・下降)。ゲーム性の担保。
 */

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  endFreq?: number;
  delayMs?: number;
  /** 立ち上がりの時間(ms)。0だと最も鋭い(打撃向き) */
  attackMs?: number;
  /** 微妙な音程のばらつき(±割合)。同じ音の連発を単調にしないため */
  jitter?: number;
}

interface NoiseOptions {
  gain?: number;
  delayMs?: number;
  filter?: BiquadFilterType;
  /** フィルタのカットオフ(Hz) */
  freq?: number;
  q?: number;
  /** 減衰カーブ。2以上で「パチッ」と切れる */
  decay?: number;
}

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  /** ユーザー操作イベント内で呼ぶこと */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.62;

      // リミッター。ピークを抑えて全体の密度を上げる
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -16;
      limiter.knee.value = 10;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.14;

      this.master.connect(limiter).connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  private now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private tone(freq: number, durationMs: number, options: ToneOptions = {}): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const {
      type = "sine",
      gain = 0.15,
      endFreq,
      delayMs = 0,
      attackMs = 0,
      jitter = 0,
    } = options;

    const jittered = jitter > 0 ? freq * (1 + (Math.random() * 2 - 1) * jitter) : freq;
    const start = this.now() + delayMs / 1000;
    const end = start + durationMs / 1000;

    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, jittered), start);
    if (endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), end);
    }

    if (attackMs > 0) {
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + attackMs / 1000);
    } else {
      g.gain.setValueAtTime(gain, start);
    }
    g.gain.exponentialRampToValueAtTime(0.0001, end);

    osc.connect(g).connect(this.master);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  private noise(durationMs: number, options: NoiseOptions = {}): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const { gain = 0.2, delayMs = 0, filter = "lowpass", freq = 2600, q = 1, decay = 1 } = options;

    const length = Math.max(1, Math.floor((this.ctx.sampleRate * durationMs) / 1000));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      // decayを上げるほど頭が強く、尻尾が短い = 打撃的になる
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.value = freq;
    biquad.Q.value = q;

    src.connect(biquad).connect(g).connect(this.master);
    src.start(this.now() + delayMs / 1000);
  }

  // ------------------------------------------------------------------
  // 打鍵
  // ------------------------------------------------------------------

  /**
   * 正解キー。1試合で数百回鳴るため、短く・軽く・毎回わずかに高さを散らす。
   * 「カチッ」という立ち上がりのノイズ + 高めの短い胴体、の2層。
   */
  keyTap(): void {
    this.noise(16, { gain: 0.05, filter: "highpass", freq: 3400, decay: 3 });
    this.tone(1420, 26, { type: "square", gain: 0.028, endFreq: 940, jitter: 0.07 });
  }

  /**
   * ミスキー。正解音と絶対に混同させないことを最優先する。
   * ・帯域を低くする(正解は高域、ミスは中低域)
   * ・半音差の2音を重ねて「うなり」を作り、濁った質感にする
   * ・はっきり下降させて「外した」ことを示す
   * 連打されても痛くないよう、長さは130ms程度に抑える。
   */
  keyMiss(): void {
    this.noise(80, { gain: 0.1, filter: "bandpass", freq: 700, q: 1.4, decay: 2 });
    // 半音差 = 不協和。2音のうなりで「濁り」を作る
    this.tone(233, 150, { type: "sawtooth", gain: 0.075, endFreq: 150 });
    this.tone(220, 150, { type: "sawtooth", gain: 0.075, endFreq: 142 });
    this.tone(520, 90, { type: "square", gain: 0.05, endFreq: 190 });
  }

  targetLock(): void {
    this.noise(12, { gain: 0.03, filter: "highpass", freq: 4000, decay: 3 });
    this.tone(760, 70, { type: "sine", gain: 0.07 });
    this.tone(1140, 90, { type: "sine", gain: 0.05, delayMs: 45 });
  }

  // ------------------------------------------------------------------
  // 爆破・連鎖
  // ------------------------------------------------------------------

  /** 爆発。連鎖が深いほど重く・派手になる */
  explosion(chain: number): void {
    const depth = Math.min(chain, 8);
    // 1. 空気を切る立ち上がり
    this.noise(70, { gain: 0.16 + depth * 0.012, filter: "highpass", freq: 1600, decay: 2.6 });
    // 2. 胴体(こもった破裂音)
    this.noise(180 + depth * 22, {
      gain: 0.16 + depth * 0.014,
      filter: "lowpass",
      freq: 1100 + depth * 90,
      decay: 1.6,
      delayMs: 8,
    });
    // 3. 低域の落ち込み。これが「腹に来る」感触を作る
    this.tone(210 + depth * 12, 260 + depth * 12, {
      type: "sine",
      gain: 0.3,
      endFreq: 42,
    });
    // 4. 深い連鎖ではサブベースを足して重量を出す
    if (depth >= 3) {
      this.tone(90, 320, { type: "triangle", gain: 0.2, endFreq: 32, delayMs: 10 });
    }
  }

  /** 連鎖ごとに音程が上がる(設計書 §15)。深いほど明るく・強くする */
  chainStep(chain: number): void {
    const scale = [523, 587, 659, 784, 880, 988, 1175, 1319, 1568, 1760];
    const idx = Math.min(chain - 1, scale.length - 1);
    const freq = scale[idx] ?? 523;
    const boost = Math.min(chain, 9) / 9;

    this.noise(14, { gain: 0.04 + boost * 0.05, filter: "highpass", freq: 4200, decay: 3 });
    this.tone(freq, 190, { type: "triangle", gain: 0.11 + boost * 0.06 });
    this.tone(freq * 1.5, 230, { type: "sine", gain: 0.05 + boost * 0.05, delayMs: 55 });
    // 深い連鎖では1オクターブ上を重ねて煌めきを足す
    if (chain >= 4) {
      this.tone(freq * 2, 260, { type: "sine", gain: 0.045, delayMs: 90 });
    }
  }

  perfect(): void {
    this.tone(1568, 90, { type: "sine", gain: 0.08 });
    this.tone(2093, 130, { type: "sine", gain: 0.06, delayMs: 60 });
  }

  // ------------------------------------------------------------------
  // 必殺技・ボーナス
  // ------------------------------------------------------------------

  /** ゲージ満タン。溜まりきった合図なので上昇形にする */
  burstReady(): void {
    this.tone(880, 100, { type: "triangle", gain: 0.1 });
    this.tone(1109, 100, { type: "triangle", gain: 0.1, delayMs: 85 });
    this.tone(1319, 220, { type: "triangle", gain: 0.13, delayMs: 170 });
    this.noise(18, { gain: 0.05, filter: "highpass", freq: 4000, decay: 3, delayMs: 170 });
  }

  /** TYPE BURST 発動。ゲーム中で最も大きい音 */
  burst(): void {
    // 吸い込み → 放出、の順で「溜めて出す」印象にする
    this.tone(300, 130, { type: "sine", gain: 0.1, endFreq: 1500 });
    this.noise(90, { gain: 0.22, filter: "highpass", freq: 2200, decay: 2.4, delayMs: 110 });
    this.noise(520, { gain: 0.3, filter: "lowpass", freq: 2000, decay: 1.4, delayMs: 120 });
    this.tone(150, 620, { type: "sawtooth", gain: 0.3, endFreq: 30, delayMs: 120 });
    this.tone(70, 640, { type: "sine", gain: 0.26, endFreq: 26, delayMs: 130 });
    this.tone(1760, 360, { type: "sine", gain: 0.1, endFreq: 440, delayMs: 180 });
  }

  allClear(): void {
    const notes = [784, 988, 1175, 1568];
    notes.forEach((f, i) =>
      this.tone(f, 220, { type: "triangle", gain: 0.13, delayMs: i * 85 }),
    );
    notes.forEach((f, i) =>
      this.tone(f * 2, 200, { type: "sine", gain: 0.05, delayMs: i * 85 + 30 }),
    );
    this.noise(320, { gain: 0.1, filter: "highpass", freq: 3000, decay: 1.6, delayMs: 340 });
  }

  /** フィーバータイム開始(単発SFX。ループBGMは使わない, D-052) */
  feverStart(): void {
    const notes = [660, 880, 1109, 1319];
    notes.forEach((f, i) =>
      this.tone(f, 150, { type: "sawtooth", gain: 0.13, delayMs: i * 65 }),
    );
    this.noise(240, { gain: 0.14, filter: "highpass", freq: 1800, decay: 1.8, delayMs: 80 });
    this.tone(110, 420, { type: "sine", gain: 0.18, endFreq: 55, delayMs: 60 });
  }

  /** フィーバータイム終了(単発SFX) */
  feverEnd(): void {
    this.tone(880, 170, { type: "triangle", gain: 0.1, endFreq: 440 });
    this.tone(523, 230, { type: "triangle", gain: 0.09, endFreq: 260, delayMs: 90 });
  }

  levelUp(): void {
    this.noise(14, { gain: 0.04, filter: "highpass", freq: 4200, decay: 3 });
    this.tone(659, 130, { type: "triangle", gain: 0.1 });
    this.tone(880, 210, { type: "triangle", gain: 0.12, delayMs: 105 });
    this.tone(1319, 220, { type: "sine", gain: 0.05, delayMs: 105 });
  }

  // ------------------------------------------------------------------
  // 盤面・妨害
  // ------------------------------------------------------------------

  garbageSend(): void {
    this.tone(300, 230, { type: "sawtooth", gain: 0.085, endFreq: 950 });
    this.noise(60, { gain: 0.05, filter: "highpass", freq: 2400, decay: 2, delayMs: 150 });
  }

  garbageLand(): void {
    this.noise(120, { gain: 0.18, filter: "lowpass", freq: 800, decay: 2 });
    this.tone(150, 170, { type: "sine", gain: 0.18, endFreq: 62 });
  }

  /** 新しい行が降ってくる。頻繁に鳴るので控えめに */
  rowDrop(): void {
    this.noise(50, { gain: 0.055, filter: "lowpass", freq: 1200, decay: 2.2 });
    this.tone(230, 130, { type: "sine", gain: 0.07, endFreq: 115 });
  }

  /** 行上昇の予告。危険の合図なので明確に切迫させる */
  riseWarning(): void {
    this.tone(330, 95, { type: "square", gain: 0.055 });
    this.tone(330, 95, { type: "square", gain: 0.055, delayMs: 135 });
  }

  /** 選択キャンセル(ミス音と混同させないよう、柔らかい下降にする) */
  cancel(): void {
    this.tone(520, 80, { type: "sine", gain: 0.06, endFreq: 330 });
  }

  // ------------------------------------------------------------------
  // 開始・終了
  // ------------------------------------------------------------------

  countdownTick(): void {
    this.tone(680, 90, { type: "sine", gain: 0.1 });
  }

  gameStart(): void {
    this.noise(24, { gain: 0.07, filter: "highpass", freq: 3000, decay: 2.6 });
    this.tone(880, 190, { type: "sine", gain: 0.14 });
    this.tone(1320, 260, { type: "sine", gain: 0.1, delayMs: 90 });
  }

  gameFinish(): void {
    this.tone(523, 210, { type: "triangle", gain: 0.12 });
    this.tone(659, 210, { type: "triangle", gain: 0.12, delayMs: 115 });
    this.tone(784, 340, { type: "triangle", gain: 0.13, delayMs: 230 });
  }

  win(): void {
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) =>
      this.tone(f, 270, { type: "triangle", gain: 0.13, delayMs: i * 125 }),
    );
    this.noise(280, { gain: 0.09, filter: "highpass", freq: 3200, decay: 1.6, delayMs: 500 });
  }

  lose(): void {
    const notes = [392, 349, 311, 262];
    notes.forEach((f, i) =>
      this.tone(f, 320, { type: "triangle", gain: 0.11, delayMs: i * 145 }),
    );
  }
}
