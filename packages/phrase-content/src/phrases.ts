import type { PhraseSeed } from "./types";

/**
 * 標準問題。全て自作の自然な日本語(CONTENT_GUIDELINES.md 参照)。
 * Tier 帯域: short 5〜7 / standard 8〜12 / long 13モーラ以上(DECISIONS.md D-003)
 */
export const PHRASE_SEEDS: readonly PhraseSeed[] = [
  // ---- 設計書サンプル由来(TYPE_BLAST_Japanese_Phrase_Samples.json) ----
  { id: "daily_0001", displayText: "空が明るくなる", readingKana: "そらがあかるくなる", tier: "standard", category: "日常" },
  { id: "daily_0002", displayText: "音が聞こえる", readingKana: "おとがきこえる", tier: "short", category: "日常" },
  { id: "daily_0003", displayText: "本を読みます", readingKana: "ほんをよみます", tier: "short", category: "日常" },
  { id: "work_0001", displayText: "資料を確認する", readingKana: "しりょうをかくにんする", tier: "standard", category: "仕事" },
  { id: "work_0002", displayText: "会議を始めます", readingKana: "かいぎをはじめます", tier: "standard", category: "仕事" },
  { id: "work_0003", displayText: "予定を共有する", readingKana: "よていをきょうゆうする", tier: "standard", category: "仕事" },
  { id: "school_0001", displayText: "ノートを見直す", readingKana: "のーとをみなおす", tier: "standard", category: "学校" },
  { id: "school_0002", displayText: "授業の準備をする", readingKana: "じゅぎょうのじゅんびをする", tier: "standard", category: "学校" },
  { id: "move_0001", displayText: "電車が駅に到着した", readingKana: "でんしゃがえきにとうちゃくした", tier: "long", category: "移動" },
  { id: "move_0002", displayText: "少し早めに出発する", readingKana: "すこしはやめにしゅっぱつする", tier: "long", category: "移動" },
  { id: "action_0001", displayText: "明日の予定を決める", readingKana: "あしたのよていをきめる", tier: "standard", category: "行動" },
  { id: "action_0002", displayText: "忘れ物に気をつける", readingKana: "わすれものにきをつける", tier: "standard", category: "行動" },
  { id: "action_0003", displayText: "新しい方法を試してみる", readingKana: "あたらしいほうほうをためしてみる", tier: "long", category: "行動" },
  { id: "positive_0001", displayText: "落ち着いて入力する", readingKana: "おちついてにゅうりょくする", tier: "standard", category: "前向き" },
  { id: "positive_0002", displayText: "最後まで正確に打ち切る", readingKana: "さいごまでせいかくにうちきる", tier: "long", category: "前向き" },
  { id: "positive_0003", displayText: "自分のペースで進める", readingKana: "じぶんのぺーすですすめる", tier: "standard", category: "前向き" },
  { id: "season_0001", displayText: "春の風が吹いている", readingKana: "はるのかぜがふいている", tier: "standard", category: "季節" },
  { id: "season_0002", displayText: "雨の音が静かに続く", readingKana: "あめのおとがしずかにつづく", tier: "long", category: "季節" },
  { id: "food_0001", displayText: "温かいご飯を食べる", readingKana: "あたたかいごはんをたべる", tier: "standard", category: "食事" },
  { id: "talk_0001", displayText: "あとで連絡します", readingKana: "あとでれんらくします", tier: "standard", category: "会話" },

  // ---- 追加分(SHORT) ----
  { id: "season_0003", displayText: "空が晴れる", readingKana: "そらがはれる", tier: "short", category: "季節" },
  { id: "food_0002", displayText: "水を飲む", readingKana: "みずをのむ", tier: "short", category: "食事" },
  { id: "daily_0004", displayText: "声が届く", readingKana: "こえがとどく", tier: "short", category: "日常" },
  { id: "action_0004", displayText: "手を洗う", readingKana: "てをあらう", tier: "short", category: "行動" },
  { id: "move_0003", displayText: "道を渡る", readingKana: "みちをわたる", tier: "short", category: "移動" },
  { id: "season_0004", displayText: "朝日がのぼる", readingKana: "あさひがのぼる", tier: "short", category: "季節" },
  { id: "talk_0002", displayText: "夢を語る", readingKana: "ゆめをかたる", tier: "short", category: "会話" },
  { id: "school_0003", displayText: "席に着く", readingKana: "せきにつく", tier: "short", category: "学校" },

  // ---- 追加分(STANDARD) ----
  { id: "daily_0005", displayText: "今日は早く帰ります", readingKana: "きょうははやくかえります", tier: "standard", category: "日常" },
  { id: "daily_0006", displayText: "窓を開けて風を通す", readingKana: "まどをあけてかぜをとおす", tier: "standard", category: "日常" },
  { id: "move_0004", displayText: "駅まで歩いて向かう", readingKana: "えきまであるいてむかう", tier: "standard", category: "移動" },
  { id: "food_0003", displayText: "昼ごはんを食べに行く", readingKana: "ひるごはんをたべにいく", tier: "standard", category: "食事" },
  { id: "work_0004", displayText: "メモを取りながら聞く", readingKana: "めもをとりながらきく", tier: "standard", category: "仕事" },
  { id: "school_0004", displayText: "質問に手を挙げる", readingKana: "しつもんにてをあげる", tier: "standard", category: "学校" },
  { id: "action_0005", displayText: "部屋を少し片付ける", readingKana: "へやをすこしかたづける", tier: "standard", category: "行動" },
  { id: "move_0005", displayText: "次の駅で乗り換える", readingKana: "つぎのえきでのりかえる", tier: "standard", category: "移動" },
  { id: "talk_0003", displayText: "友達と少し話す", readingKana: "ともだちとすこしはなす", tier: "standard", category: "会話" },
  { id: "food_0004", displayText: "熱いお茶を飲む", readingKana: "あついおちゃをのむ", tier: "standard", category: "食事" },
  { id: "positive_0004", displayText: "深呼吸して落ち着く", readingKana: "しんこきゅうしておちつく", tier: "standard", category: "前向き" },
  { id: "work_0005", displayText: "今日の目標を書く", readingKana: "きょうのもくひょうをかく", tier: "standard", category: "仕事" },
  { id: "daily_0007", displayText: "買い物のリストを作る", readingKana: "かいもののりすとをつくる", tier: "standard", category: "日常" },
  { id: "school_0005", displayText: "図書館で本を借りる", readingKana: "としょかんでほんをかりる", tier: "standard", category: "学校" },
  { id: "season_0005", displayText: "夜空の星を眺める", readingKana: "よぞらのほしをながめる", tier: "standard", category: "季節" },
  { id: "positive_0005", displayText: "小さな一歩を重ねる", readingKana: "ちいさないっぽをかさねる", tier: "standard", category: "前向き" },

  // ---- 追加分(LONG) ----
  { id: "action_0006", displayText: "新しい方法をみんなで試してみる", readingKana: "あたらしいほうほうをみんなでためしてみる", tier: "long", category: "行動" },
  { id: "daily_0008", displayText: "今日は少し早めに寝ようと思う", readingKana: "きょうはすこしはやめにねようとおもう", tier: "long", category: "日常" },
  { id: "season_0006", displayText: "窓の外の景色をゆっくり眺める", readingKana: "まどのそとのけしきをゆっくりながめる", tier: "long", category: "季節" },
  { id: "work_0006", displayText: "明日の会議の資料をまとめておく", readingKana: "あしたのかいぎのしりょうをまとめておく", tier: "long", category: "仕事" },
  { id: "move_0006", displayText: "駅前のパン屋に寄ってから帰る", readingKana: "えきまえのぱんやによってからかえる", tier: "long", category: "移動" },
  { id: "food_0005", displayText: "温かいスープを飲んで一息つく", readingKana: "あたたかいすーぷをのんでひといきつく", tier: "long", category: "食事" },
  { id: "positive_0006", displayText: "練習を続ければ必ず速くなる", readingKana: "れんしゅうをつづければかならずはやくなる", tier: "long", category: "前向き" },
  { id: "school_0006", displayText: "授業の内容を友達と確認する", readingKana: "じゅぎょうのないようをともだちとかくにんする", tier: "long", category: "学校" },
  { id: "positive_0007", displayText: "静かな朝に本を開く", readingKana: "しずかなあさにほんをひらく", tier: "long", category: "前向き" },
];

/**
 * 妨害ブロック用の文章(無属性ブロックに表示)。
 * DUEL / GHOST 実装時に使用する。
 */
export const GARBAGE_PHRASE_SEEDS: readonly PhraseSeed[] = [
  { id: "garbage_0001", displayText: "焦らず確実に入力する", readingKana: "あせらずかくじつににゅうりょくする", tier: "long", category: "妨害" },
  { id: "garbage_0002", displayText: "最後まで正確に打つ", readingKana: "さいごまでせいかくにうつ", tier: "standard", category: "妨害" },
  { id: "garbage_0003", displayText: "目の前の文章に集中する", readingKana: "めのまえのぶんしょうにしゅうちゅうする", tier: "long", category: "妨害" },
  { id: "garbage_0004", displayText: "慌てず一文字ずつ進める", readingKana: "あわてずひともじずつすすめる", tier: "long", category: "妨害" },
  { id: "garbage_0005", displayText: "指先に意識を向ける", readingKana: "ゆびさきにいしきをむける", tier: "standard", category: "妨害" },
  { id: "garbage_0006", displayText: "姿勢を正して構える", readingKana: "しせいをただしてかまえる", tier: "standard", category: "妨害" },
  { id: "garbage_0007", displayText: "深呼吸してから打つ", readingKana: "しんこきゅうしてからうつ", tier: "standard", category: "妨害" },
  { id: "garbage_0008", displayText: "リズムを崩さず打ち続ける", readingKana: "りずむをくずさずうちつづける", tier: "long", category: "妨害" },
];
