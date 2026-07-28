export type SpeedTestPrompt = {
  ja: string;
  reading: string;
};

/**
 * 速度測定に出す読み。表示用のローマ字文字列を持たず、ゲーム本体と同じ
 * TypingAutomaton に読みを渡して判定するため、複数の正規ローマ字表記を受理できる。
 */
export const SPEED_TEST_PROMPTS: readonly SpeedTestPrompt[] = [
  { ja: "今日は集中して練習する", reading: "きょうはしゅうちゅうしてれんしゅうする" },
  { ja: "正確さを保って少しずつ速く", reading: "せいかくさをたもってすこしずつはやく" },
  { ja: "ホームポジションへ指を戻す", reading: "ほーむぽじしょんへゆびをもどす" },
  { ja: "ミスの原因を一つずつ直す", reading: "みすのげんいんをひとつずつなおす" },
  { ja: "毎日の短い反復が力になる", reading: "まいにちのみじかいはんぷくがちからになる" },
  { ja: "画面を見ながら一定のリズムで打つ", reading: "がめんをみながらいっていのりずむでうつ" },
  { ja: "焦らず滑らかな入力を目指す", reading: "あせらずなめらかなにゅうりょくをめざす" },
  { ja: "タイピングと連鎖パズルを楽しむ", reading: "たいぴんぐとれんさぱずるをたのしむ" },
];
