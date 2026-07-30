/**
 * かな入力／ローマ字入力 判定(D-092)。
 *
 * 「どちらが速いか」は一般論では決まらない。文献上の平均打鍵数で言えば
 * かな入力の方が打鍵数は少ないが、実際の速度は習熟度に完全に支配される。
 * そのため本ツールは「一般にどちらが優れているか」を断定せず、
 * 利用者自身の状況（現在の方式・習熟度・用途）から判断材料を返す。
 *
 * 断定を避けるのは逃げではなく、断定できるだけの根拠が無いため。
 * 根拠のない「かな入力の方が速い」を書いた瞬間に、他の記事の信頼も落ちる。
 */

export type CurrentMethod = "romaji" | "kana" | "unknown";

export interface AdviceInput {
  /** 現在の主な入力方式 */
  current: CurrentMethod;
  /** 直近の測定で出た1分あたりの正しい打鍵数。未測定なら null */
  kpm: number | null;
  /** 日本語以外（英字・プログラミング等）を打つ頻度が高いか */
  typesLatin: boolean;
  /** 自分以外の端末を使う機会があるか */
  sharesDevices: boolean;
}

export interface Advice {
  /** 見出しに出す結論 */
  verdict: string;
  /** なぜそう判断したか */
  reason: string;
  /** 次にやること */
  action: string;
  /** 判断の前提。必ず表示する */
  caveat: string;
  linkHref: string;
  linkLabel: string;
}

const ROMAJI_LINK = { href: "/guides/romaji-typing-practice.html", label: "ローマ字入力の練習方法を見る" };
const SPEED_LINK = { href: "/tools/typing-speed-test.html", label: "まず今の速度を測る" };
const WEAK_LINK = { href: "/tools/weak-key-practice.html", label: "苦手キーを練習する" };

/**
 * 乗り換えを勧めるかどうかの中心的な判断。
 *
 * かな入力への乗り換えは、習得に数か月かかり、その間は入力速度が確実に落ちる。
 * 「今すでに実用速度が出ている人」に勧めるのは、利益より損失が大きい。
 */
export function adviseInputMethod(input: AdviceInput): Advice {
  const { current, kpm, typesLatin, sharesDevices } = input;

  if (kpm === null) {
    return {
      verdict: "まず現在の速度を測ってください",
      reason:
        "入力方式を変えるべきかは、今どのくらい打てているかで結論が変わります。測定せずに方式だけを変えると、速くなったのか慣れただけなのか判断できません。",
      action: "60秒の測定を3回行い、中央の値を基準にしてください。",
      caveat: "この判定は一般論の優劣ではなく、あなたの状況から次の一手を選ぶためのものです。",
      linkHref: SPEED_LINK.href,
      linkLabel: SPEED_LINK.label,
    };
  }

  // 既に実用速度が出ている人に乗り換えは勧めない。失うものの方が大きい。
  if (kpm >= 250) {
    return {
      verdict: current === "kana" ? "かな入力のままで問題ありません" : "ローマ字入力のままで問題ありません",
      reason: `1分あたり${Math.round(kpm)}打鍵は、日常の文書作成で不自由しない水準です。入力方式の変更は習得に数か月かかり、その間は確実に今より遅くなります。得られるものより失うものが大きい段階です。`,
      action: "方式を変えるより、ミスの多いキーを1つずつ潰す方が短期間で効果が出ます。",
      caveat: "打鍵数の理論値ではかな入力が有利とされますが、実際の速度は習熟度に支配されます。今の方式で伸ばすのが合理的です。",
      linkHref: WEAK_LINK.href,
      linkLabel: WEAK_LINK.label,
    };
  }

  if (current === "kana") {
    return {
      verdict: "かな入力を続けつつ、ローマ字も最低限使えるようにしてください",
      reason:
        "かな入力に慣れているなら、それを捨てる理由はありません。ただし、かな入力の設定が入っていない端末では入力そのものができなくなります。",
      action: "普段はかな入力のまま、ローマ字は「短い文を打てる」程度を目標にしてください。完璧である必要はありません。",
      caveat: "この判定は方式の優劣ではなく、環境が変わったときに困らないための備えです。",
      linkHref: ROMAJI_LINK.href,
      linkLabel: ROMAJI_LINK.label,
    };
  }

  // ローマ字入力または未確定で、まだ速度が出ていない人
  const latinReason = typesLatin
    ? "英字やプログラミングの入力が多い場合、ローマ字入力ならアルファベットの配置がそのまま活きます。"
    : "";
  const deviceReason = sharesDevices
    ? "自分以外の端末を使う機会があるなら、初期設定のままで使えるローマ字入力が確実です。"
    : "";

  return {
    verdict: "ローマ字入力を続けてください",
    reason: `${`まだ速度が伸びきっていない段階です。この時点で方式を変えると、これまでの練習が一度リセットされます。`}${latinReason}${deviceReason}`,
    action: "覚えるキーはアルファベット26文字だけです。ホームポジションを固定して、指の担当を先に決めてください。",
    caveat: "かな入力は打鍵数が少ない利点がありますが、覚えるキーが約50個に増え、習得に数か月かかります。今の段階では負担の方が大きくなります。",
    linkHref: ROMAJI_LINK.href,
    linkLabel: ROMAJI_LINK.label,
  };
}

/** 参考として表示する、方式ごとの事実ベースの比較 */
export const METHOD_FACTS = [
  {
    item: "覚えるキーの数",
    romaji: "アルファベット26個",
    kana: "かな約50個",
  },
  {
    item: "1文字あたりの打鍵数",
    romaji: "多くのかなで2打鍵",
    kana: "原則1打鍵",
  },
  {
    item: "英字・記号との相性",
    romaji: "配置が共通で切り替え不要",
    kana: "英字入力では配置が変わる",
  },
  {
    item: "他人の端末での利用",
    romaji: "初期設定のまま使える",
    kana: "入力方式の切り替えが必要",
  },
  {
    item: "習得までの負担",
    romaji: "小さい",
    kana: "大きい（数か月）",
  },
] as const;
