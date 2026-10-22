import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import {
  M1_PRESET_IDS,
  M1PresetCatalogError,
  loadM1PresetCatalog,
  m1DeckDigest,
  matchingM1Preset
} from "../../src/presets/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("M1 preset catalog", () => {
  it("builds both 56-card presets from the shared headless source and validates them", async () => {
    const catalog = await loadCardCatalogRuntime();
    const presets = await loadM1PresetCatalog(catalog);

    expect(presets.schemaVersion).toBe("riftbound.m1-preset-catalog.v1");
    expect(presets.presets.map(preset => preset.id)).toEqual(M1_PRESET_IDS);
    for (const preset of presets.presets) {
      expect(preset.cardCount).toBe(56);
      expect(preset.zoneCounts).toEqual({
        legend: 1,
        champion: 1,
        mainDeck: 39,
        runes: 12,
        battlefields: 3,
        total: 56
      });
      expect(preset.legend.name.length).toBeGreaterThan(0);
      expect(preset.champion.name.length).toBeGreaterThan(0);
      expect(preset.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(preset.digest).toBe(m1DeckDigest(preset.deck));
      expect(validateCatalogDeck(catalog, preset.deck)).toMatchObject({
        valid: true,
        issues: [],
        printingIssues: []
      });
      expect(matchingM1Preset(preset.deck, presets)).toBe(preset);
    }

    // The selected printings are released SFD printings, including Yone whose
    // canonical group currently points at a not-yet-released RAD preview.
    const serialized = JSON.stringify(presets.presets);
    expect(serialized).not.toContain("rad-");
  });

  it("hashes canonical deck contents independently of entry order and split quantities", async () => {
    const catalog = await loadCardCatalogRuntime();
    const presetCatalog = await loadM1PresetCatalog(catalog);
    const expected = presetCatalog.presets[0];
    const split = structuredClone(expected.deck);
    const reordered = {
      mainDeck: [...split.mainDeck!].reverse(),
      runes: [...split.runes!].reverse(),
      legend: split.legend,
      champion: split.champion,
      battlefields: [...split.battlefields!].reverse()
    };

    const splitEntry = reordered.mainDeck.find(entry => entry.quantity > 1);
    expect(splitEntry).toBeDefined();
    reordered.mainDeck = [
      ...reordered.mainDeck.filter(entry => entry !== splitEntry),
      { cardId: splitEntry!.cardId, quantity: 1 },
      { cardId: splitEntry!.cardId, quantity: splitEntry!.quantity - 1 }
    ];

    expect(m1DeckDigest(reordered)).toBe(expected.digest);
    expect(matchingM1Preset(reordered, presetCatalog)?.id).toBe(expected.id);
  });

  it("fails clearly when the generated catalog is unavailable", async () => {
    const catalog = await loadCardCatalogRuntime();
    const directory = await mkdtemp(path.join("/tmp", "rift-926-missing-catalog-"));
    directories.push(directory);
    const missing = path.join(directory, "deck-catalog.json");

    await expect(loadM1PresetCatalog(catalog, { catalogPath: missing }))
      .rejects.toMatchObject({
        name: "M1PresetCatalogError",
        code: "m1-preset-catalog-unavailable",
        message: expect.stringContaining(missing)
      } satisfies Partial<M1PresetCatalogError>);
  });
});
