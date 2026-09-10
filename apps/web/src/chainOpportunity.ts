import type { PlayerSnapshot } from "@type-burst/game-core";

/** UI-only hint. Never redirect an active input or recommend a disappearing block. */
export function chainOpportunityHint(player: Pick<PlayerSnapshot, "blocks" | "chainPreviews" | "resolving" | "typedRomaji"> | null) {
  if (!player) return null;
  if (player.resolving) return { title: "連鎖を解決中", detail: "盤面が落ち着くと次の候補を表示" };
  if (player.typedRomaji) return { title: "入力中の言葉に集中", detail: "ミスしても続きから入力できます" };
  const available = player.chainPreviews.filter(item => player.blocks.some(block => block.id === item.blockId && block.state !== "clearing"));
  const best = available.reduce<(typeof available)[number] | undefined>((best, item) =>
    !best || item.predictedDepth > best.predictedDepth ||
      (item.predictedDepth === best.predictedDepth && item.predictedClearedCount > best.predictedClearedCount) ? item : best, undefined);
  if (!best) return null;
  const word = player.blocks.find(block => block.id === best.blockId)!.displayText;
  return { title: `${best.predictedDepth}連鎖予測 · ${best.predictedClearedCount}個消去`, detail: `起点「${word}」` };
}
