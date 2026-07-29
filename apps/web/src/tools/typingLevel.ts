export type TypingLevel = {
  label: string;
  summary: string;
  nextAction: string;
  href: string;
  linkLabel: string;
};

/**
 * TYPE BURST独自の練習目安。
 * 公的な検定基準ではなく、速度と正確率から次の練習を選ぶためにだけ使う。
 */
export function diagnoseTypingLevel(kpm: number, accuracy: number): TypingLevel {
  if (accuracy < 90) {
    return {
      label: "基礎を整える段階",
      summary: "速度よりも、キー位置とローマ字を迷わず選べる状態を先に作りましょう。",
      nextAction: "苦手なキーを一度に増やさず、最も止まった文字から10語だけ練習します。",
      href: "/tools/weak-key-practice.html",
      linkLabel: "苦手キーを練習する",
    };
  }
  if (accuracy < 95) {
    return {
      label: "正確性を安定させる段階",
      summary: "入力速度は出ていますが、急いだときのミスが結果を下げています。",
      nextAction: "今の速度を少し落とし、同じ60秒で正確率95％以上を再現できるか確認します。",
      href: "/guides/typing-accuracy.html",
      linkLabel: "正確率の上げ方を見る",
    };
  }
  if (kpm < 150) {
    return {
      label: "入門",
      summary: "正確さを保ちながら、キーを探す時間を短くしていく段階です。",
      nextAction: "短文を3文ずつ打ち、止まったキーだけを覚え直します。",
      href: "/tools/sentence-typing-practice.html",
      linkLabel: "短文から練習する",
    };
  }
  if (kpm < 250) {
    return {
      label: "初級",
      summary: "基本のローマ字入力は安定しています。文章の途中で止まらないことを目指しましょう。",
      nextAction: "標準文を5文続け、正確率を維持したまま入力の流れを整えます。",
      href: "/tools/sentence-typing-practice.html",
      linkLabel: "文章で流れを整える",
    };
  }
  if (kpm < 350) {
    return {
      label: "中級",
      summary: "日常的な入力を安定して続けられる速度です。苦手な並びを減らすとさらに伸びます。",
      nextAction: "結果分析や苦手キー練習で、繰り返すミスを1種類ずつ減らします。",
      href: "/tools/weak-key-practice.html",
      linkLabel: "苦手キーを絞り込む",
    };
  }
  if (kpm < 450) {
    return {
      label: "上級",
      summary: "速さと正確さが両立しています。長い文章でも同じリズムを保てるか確認しましょう。",
      nextAction: "長めの文章を続けて入力し、後半の失速と正確率を確認します。",
      href: "/tools/sentence-typing-practice.html",
      linkLabel: "長めの文章に挑戦する",
    };
  }
  return {
    label: "高速・熟練",
    summary: "高い速度を正確に維持できています。判断を伴う入力で実戦力を試せます。",
    nextAction: "盤面を選びながら打つTYPE BURSTで、速度だけではない判断力と安定性を試します。",
    href: "/?mode=survival&difficulty=hard&source=tool-speed-diagnosis#play",
    linkLabel: "上級サバイバルで試す",
  };
}
