---
title: "日本語タイピングゲームを作ると必ずぶつかる、ローマ字入力の「複数の正解」問題"
emoji: "🔤"
type: "tech"
topics: ["typescript", "日本語", "アルゴリズム", "オートマトン", "個人開発"]
published: false
---

「し」は `shi` と打っても `si` と打っても正しい。

日本語のタイピングゲームを作ろうとすると、最初の30分でこの事実に殴られます。そして「じゃあ両方受理すればいいのでは」と思った瞬間から、想像よりずっと深い沼が始まります。

この記事では、日本語ローマ字入力の受理判定がなぜ単純な文字列比較で解けないのかを整理し、最終的に**非決定性有限オートマトン（NFA）**へ落とし込むまでを書きます。TypeScriptですが、考え方は言語に依りません。

:::message
サンプルコードは説明用に簡略化しています。実際の実装（重複除去やクローン処理など）は末尾の[ソースコードへのリンク](https://github.com/shou0903/type-burst/blob/master/packages/typing-engine/src/automaton.ts)から確認できます。
:::

## 素朴な実装はどこで壊れるか

まず「読み仮名をローマ字に変換して、打たれたキーと前方一致で比較する」を考えます。

```ts
const romaji = toRomaji("しんかんせん"); // "shinkansen"
const ok = romaji.startsWith(typed);
```

これは `si` と打った瞬間に壊れます。`shinkansen` は `si` で始まらないからです。

では「候補を全部作って、どれかに前方一致すればOK」にしてみます。

```ts
const candidates = ["shinkansen", "sinkansen", "shinkansenn", ...];
const ok = candidates.some((c) => c.startsWith(typed));
```

方向性は正しいのですが、候補の数が爆発します。「しんかんせん」は6文字ですが、各かなの表記ゆれを掛け合わせると候補は数十通りになります。20文字の文章なら組み合わせは軽く数万を超えます。

しかも、**文字列を全部展開しても解けない問題**がこの先にあります。

## 沼その1：促音「っ」は次の文字に依存する

「がっこう」の「っ」はどう打つか。

- `gakkou` — 次の子音を重ねる
- `gaxtukou` — `xtu` で促音そのものを打つ
- `galtukou` — `ltu` でも打てる

つまり**「っ」単体のローマ字表記は決まらない**。次に何が来るかで決まります。

さらに厄介なのは、次が母音の場合です。「あっ」＋「い」で `aaii` とは打てません。母音は重ねられないからです。

そして意外な落とし穴があります。

:::message
次が「な行」のとき、子音重複は使えません。「あんない」を考えてみてください。もし「っ」の直後の `n` を重ねられるとすると、`nn` という並びが「ん」なのか「っ＋な行」なのか判別できなくなります。
:::

実装では明示的に除外する必要があります。

```ts
for (const alt of next.alternatives) {
  const head = alt.charAt(0);
  // 子音開始なら先頭子音の重複で促音を表現
  // n 始まりは「ん」と衝突するため除外する
  if (!isVowelChar(head) && head !== "n") {
    alts.push(head + alt);
  }
}
```

## 沼その2：「ん」は単独の `n` で打てるときと打てないときがある

ここが一番おもしろいところです。

「かんじ」は `kanji` と打てます。`n` 一文字で「ん」が確定する。

ところが「かんい（簡易）」は `kani` と打つと「かに」になってしまいます。`n` の次に母音が来ると、`n` が「な行」の子音として解釈されうるからです。だから「かんい」は `kanni` と打つ必要があります。

同じことが「な行」と「や行」でも起きます。

- 「しんや」→ `shinnya`（`shinya` だと「しにゃ」）
- 「あんない」→ `annnai`

:::message
2つ目に注目してください。**`n` が3つ必要**です。「ん」で `nn`、「な」で `na` なので、`nn` + `na` が連続して `nnn` になります。`annai` と打つと「あんあい」になってしまいます。
:::

日本語入力に慣れている人ほど無意識にやっている操作ですが、いざ受理判定を書く側に回ると、この手の規則を一つずつ言語化する羽目になります。

つまり**単独 `n` が許されるのは、次のセグメントが母音・n・y のいずれでも始まらないときだけ**です。

```ts
// 次が母音・な行・や行で始まり得る場合、単独 n は曖昧になるため禁止
allowSingleN = !nextAlts.some((alt) => {
  const head = alt.charAt(0);
  return isVowelChar(head) || head === "n" || head === "y";
});
```

注目してほしいのは、判定条件が「次のかな」ではなく「**次のセグメントが取りうる全表記の先頭文字**」である点です。

「ん」＋「ち」を考えます。「ち」は `chi` と `ti` の両方で打てます。`ti` 側は `t` 始まりなので単独 `n` を許してよさそうに見えますが、実際には `chi` 側があるので判定は表記ごとではなくセグメント単位で行う必要があります。この例では両方とも母音・n・y で始まらないので単独 `n` が許されますが、条件を「代表表記だけ」で判定すると、別のケースで穴が空きます。

## 沼その3：拗音は分解して打てる

「きゃ」は `kya` ですが、`kixya` とも打てます。「き」＋「小さいゃ」を分解して入力する打ち方です。

普段使わない人も多いですが、実際にこう打つ人はいます。受理しないと「正しく打ったのにミス判定された」という最悪の体験になります。

```ts
// 分解入力(し + ゃ = sixya など)も受理する
const base = KANA_TO_ROMAJI[c1];
const small = KANA_TO_ROMAJI[c2];
if (base && small) {
  for (const b of base) {
    for (const s of small) {
      alts.push(b + s);
    }
  }
}
```

## 解法：セグメント列 + NFA

ここまでの制約を並べると、性質が見えてきます。

- 受理単位は「かな1文字」ではない（っ＋次、拗音の2文字）
- 各単位は**複数の表記**を持つ
- ある単位の表記は**隣の単位に依存する**ことがある
- 途中まで打った状態では、**どの表記を選んだか確定しない**

最後の性質が決定的です。`k` を打った時点では `ka` なのか `ki` なのか分かりません。「し」で `s` を打った時点では `shi` か `si` か決まっていません。

:::message
確定しないなら、確定させなければいい。これはそのままNFAです。
:::

まず読み仮名をセグメント列へ変換します。

```ts
interface KanaSegment {
  kana: string;
  alternatives: readonly string[]; // 先頭が標準表記
}
```

「がっこう」なら、`っこ` が1セグメントになり `["kko", "xtuko", "ltuko", ...]` を持ちます。

状態は「何番目のセグメントを、どこまで打ったか」だけで表せます。

```ts
interface AutomatonState {
  seg: number;      // セグメント番号
  prefix: string;   // そのセグメント内で打ち終わった部分
}
```

現在の状態は**集合**です。1キー受理するたびに、全状態から遷移可能なものだけを残します。

```ts
feed(key: string): FeedResult {
  const next: AutomatonState[] = [];
  for (const state of this.states) {
    const segment = this.segments[state.seg];
    if (!segment) continue;
    for (const alt of segment.alternatives) {
      if (
        alt.length > state.prefix.length &&
        alt.startsWith(state.prefix) &&
        alt.charAt(state.prefix.length) === key
      ) {
        next.push({ seg: state.seg, prefix: state.prefix + key });
      }
    }
  }
  if (next.length === 0) {
    return { accepted: false, completed: this.isAccepted() };
  }
  this.states = this.closure(next);
  return { accepted: true, completed: this.isAccepted() };
}
```

`closure` が ε遷移にあたります。セグメントの表記をちょうど打ち切った状態は、次のセグメントの先頭と同一視されます。

```ts
private closure(states: AutomatonState[]): AutomatonState[] {
  const result: AutomatonState[] = [];
  const queue = [...states];
  while (queue.length > 0) {
    const state = queue.pop()!;
    // ...重複除去...
    result.push(state);
    const segment = this.segments[state.seg];
    if (segment && segment.alternatives.includes(state.prefix)) {
      queue.push({ seg: state.seg + 1, prefix: "" });
    }
  }
  return result;
}
```

これで、文字列を事前展開せずに全経路を同時に扱えます。状態数はセグメント数×表記長に収まるので、文章が長くなっても線形です。

副産物として、実装が非常に素直になります。

- **次に打てるキー一覧** — 全状態から次の1文字を集める。ガイド表示に使う
- **進捗率** — 打鍵済み数 ÷（打鍵済み数＋最短残り）
- **完了判定** — 最終セグメントに到達した状態があるか

## おまけの沼：出題が「先に完成」してしまう

ここからは、タイピング**ゲーム**特有の問題です。

盤面に複数の語を同時に置き、プレイヤーがどれを打つか自由に選べる仕様にしました。打ち始めたキーで対象を絞り込みます。

ここで事故が起きます。盤面に「か」と「かき」が同時にあると、`ka` を打った瞬間に「か」が完成してしまい、「かき」を打ちたかったのに割り込まれます。

素朴には「片方がもう片方の接頭辞なら弾く」で済みそうですが、**表記ゆれがあるので文字列比較では判定できません。**「し」と「しお」は標準表記だと `shi` と `shio` ですが、`si` / `sio` という経路もあります。どの経路で衝突するか分かりません。

そこで、2つのオートマトンを**同時に歩かせて**、共通のキー列で片方だけが受理状態に入るかを幅優先で探索します。

```ts
static hasCompletionPrefixConflict(left: string, right: string): boolean {
  const queue = [[new TypingAutomaton(left), new TypingAutomaton(right)]];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const [l, r] = queue.pop()!;
    const signature = `${l.stateSignature()}|${r.stateSignature()}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    if (l.isAccepted() || r.isAccepted()) return true;

    const rightKeys = new Set(r.getExpectedKeys());
    for (const key of l.getExpectedKeys()) {
      if (!rightKeys.has(key)) continue;
      // 両方が受理できるキーだけを進める
      queue.push([l.cloneAndFeed(key), r.cloneAndFeed(key)]);
    }
  }
  return false;
}
```

状態集合の署名でメモ化しているので、探索は現実的な時間で終わります。これを出題生成時に通し、衝突する組み合わせを盤面に置かないようにしています。

## まとめ

日本語ローマ字入力の受理は、**文字列比較の問題ではなく状態遷移の問題**です。

- かな1文字と入力単位は一致しない
- 表記は隣の文字に依存する（っ、ん）
- 途中では経路が確定しない

この3つを認めた時点で、答えはNFAに決まります。逆に言うと、文字列比較で頑張っている限り「なぜか特定の単語だけミス判定される」バグが延々と出続けます。心当たりのある方は、一度セグメント + 状態集合で書き直してみてください。実装量はむしろ減ります。

実装で参考にしたい方向けに、判定ロジックの入口だけ書いておきます。

```ts
const automaton = new TypingAutomaton("がっこう");
automaton.getCanonicalRomaji(); // "gakkou"
automaton.feed("g"); // { accepted: true, completed: false }
automaton.getExpectedKeys(); // ["a"]
```

---

:::message
このエンジンは、私が作っている日本語タイピングゲーム [TYPE BURST](https://type-burst.com/) で使っています。打ち切ったブロックが爆発して連鎖するパズルで、無料・登録不要です。本記事のNFAは、ゲーム中に表示される「次に打つキー」のガイドと、盤面の出題生成の両方を支えています。

ソースコードは公開しています。今回扱った `TypingAutomaton` は [automaton.ts](https://github.com/shou0903/type-burst/blob/master/packages/typing-engine/src/automaton.ts) にあります。
:::
