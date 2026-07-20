export type PhraseTier = "short" | "standard" | "long";

export interface JapanesePhrase {
  id: string;
  displayText: string;
  readingKana: string;
  tier: PhraseTier;
  category: string;
  moraCount: number;
  weight: number;
  enabled: boolean;
  source: "original";
  notes?: string;
}

/** データ定義時は moraCount を書かず、読み仮名から自動計算する */
export type PhraseSeed = Omit<JapanesePhrase, "moraCount" | "weight" | "enabled" | "source"> & {
  weight?: number;
};
