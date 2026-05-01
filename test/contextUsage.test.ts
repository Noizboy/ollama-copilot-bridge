import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildContextUsageSnapshot, estimateTokenCount, formatTokenCount } from "../src/contextUsage";

describe("context usage helpers", () => {
  it("estimates token count from text", () => {
    assert.equal(estimateTokenCount(""), 0);
    assert.equal(estimateTokenCount("1234"), 1);
    assert.equal(estimateTokenCount("12345"), 2);
  });

  it("builds a snapshot with bounded context percentage", () => {
    const snapshot = buildContextUsageSnapshot({
      modelId: "kimi-k2.6",
      modelName: "Kimi-K2.6",
      maxInputTokens: 10,
      maxOutputTokens: 5,
      requestMultiplier: 2,
      inputText: "x".repeat(80),
      outputText: "done"
    });

    assert.equal(snapshot.inputTokens, 20);
    assert.equal(snapshot.outputTokens, 1);
    assert.equal(snapshot.inputPercent, 100);
    assert.equal(snapshot.totalTokens, 21);
    assert.equal(snapshot.requestMultiplier, 2);
  });

  it("formats token counts compactly", () => {
    assert.equal(formatTokenCount(999), "999");
    assert.equal(formatTokenCount(1500), "1.5K");
    assert.equal(formatTokenCount(12_300), "12K");
    assert.equal(formatTokenCount(1_500_000), "1.5M");
  });
});
