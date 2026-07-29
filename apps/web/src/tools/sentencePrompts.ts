export type SentencePracticeLevel = "beginner" | "standard" | "long";

export type SentencePracticePrompt = {
  ja: string;
  reading: string;
};

export const SENTENCE_PRACTICE_PROMPTS: Readonly<
  Record<SentencePracticeLevel, readonly SentencePracticePrompt[]>
> = {
  beginner: [
    { ja: "今日もゆっくり練習する", reading: "きょうもゆっくりれんしゅうする" },
    { ja: "朝の光が部屋に入る", reading: "あさのひかりがへやにはいる" },
    { ja: "指を元の位置に戻す", reading: "ゆびをもとのいちにもどす" },
    { ja: "深呼吸してから始めよう", reading: "しんこきゅうしてからはじめよう" },
    { ja: "正しいキーを確かめて打つ", reading: "ただしいきーをたしかめてうつ" },
    { ja: "短い文を丁寧に入力する", reading: "みじかいぶんをていねいににゅうりょくする" },
  ],
  standard: [
    { ja: "予定を確認してから一日の作業を始める", reading: "よていをかくにんしてからいちにちのさぎょうをはじめる" },
    { ja: "急ぐときほど正確な入力を意識する", reading: "いそぐときほどせいかくなにゅうりょくをいしきする" },
    { ja: "読みやすい文章は適度な余白から生まれる", reading: "よみやすいぶんしょうはてきどなよはくからうまれる" },
    { ja: "小さな改善を毎日の習慣へつなげていく", reading: "ちいさなかいぜんをまいにちのしゅうかんへつなげていく" },
    { ja: "入力の前に次の言葉を少しだけ先読みする", reading: "にゅうりょくのまえにつぎのことばをすこしだけさきよみする" },
    { ja: "同じ条件で測ると本当の変化が見えやすい", reading: "おなじじょうけんではかるとほんとうのへんかがみえやすい" },
  ],
  long: [
    {
      ja: "会議の前に資料を読み直し伝えたい要点を三つに整理しておく",
      reading: "かいぎのまえにしりょうをよみなおしつたえたいようてんをみっつにせいりしておく",
    },
    {
      ja: "正確さを保ったまま長い文章を打つには最初から飛ばしすぎないことが大切だ",
      reading: "せいかくさをたもったままながいぶんしょうをうつにはさいしょからとばしすぎないことがたいせつだ",
    },
    {
      ja: "作業が終わったら数字だけでなく途中で止まった文字や疲れ方も記録する",
      reading: "さぎょうがおわったらすうじだけでなくとちゅうでとまったもじやつかれかたもきろくする",
    },
    {
      ja: "画面の文章を意味のまとまりで読むと視線と指の動きを合わせやすくなる",
      reading: "がめんのぶんしょうをいみのまとまりでよむとしせんとゆびのうごきをあわせやすくなる",
    },
    {
      ja: "一度の最高記録より同じ練習を落ち着いて再現できることを目標にする",
      reading: "いちどのさいこうきろくよりおなじれんしゅうをおちついてさいげんできることをもくひょうにする",
    },
    {
      ja: "苦手なキーの直前だけ少し速度を落とすと文章全体の流れを止めずに済む",
      reading: "にがてなきーのちょくぜんだけすこしそくどをおとすとぶんしょうぜんたいのながれをとめずにすむ",
    },
  ],
};

export function promptsForLevel(level: SentencePracticeLevel): readonly SentencePracticePrompt[] {
  return SENTENCE_PRACTICE_PROMPTS[level];
}
