import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, PlayerCore, Prng } from "@type-burst/game-core";
import { GARBAGE_PHRASES, PHRASES } from "@type-burst/phrase-content";
import { AttractDemoDriver } from "./attractDemoDriver";

describe("AttractDemoDriver", () => {
  it("primes a representative input state before the first animation frame", () => {
    const core = new PlayerCore(
      "attract-demo-a",
      PHRASES,
      GARBAGE_PHRASES,
      DEFAULT_CONFIG,
      DEFAULT_CONFIG.survivalRise,
    );
    const driver = new AttractDemoDriver(
      core,
      new Prng("attract-demo-a:attract-driver"),
      DEFAULT_CONFIG,
    );

    driver.prime();
    const snapshot = core.getSnapshot();

    expect(snapshot.blocks.length).toBeGreaterThan(0);
    expect(snapshot.typedRomaji.length).toBeGreaterThan(0);
    expect(snapshot.candidateBlockIds.length).toBeGreaterThan(0);
  });
});
