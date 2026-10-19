import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  M1_ACCEPTANCE_GAMES,
  M1_ACCEPTANCE_GAMES_PER_SIDE,
  M1_ACCEPTANCE_PLAN,
  aggregateM1Evidence,
  isNaturalM1Game,
  probeM1Acceptance,
  type M1GameEvidence,
} from "../../src/headless/m1-pair.js";
import { buildM1Deck } from "../../src/headless/decks.js";

interface ManifestCard {
  readonly canonicalCardId: string;
  readonly name: string;
  readonly printed: {
    readonly energy: number | null;
    readonly power: number | null;
  };
  readonly program: { readonly path: string; readonly sha256: string };
  readonly goldens: {
    readonly independent: { readonly path: string; readonly sha256: string };
    readonly templates: readonly { readonly path: string; readonly sha256: string }[];
  };
  readonly goldenExecution: {
    readonly observedAt: string;
    readonly exitCode: number;
    readonly pass: number;
    readonly fail: number;
    readonly todo: number;
    readonly wholeCardStatus: "unproven" | "complete";
  };
  readonly verificationStatus: string;
  readonly productionAcceptance: string;
  readonly evidenceGap: string | null;
  readonly ir: {
    readonly abilityKinds: readonly string[];
    readonly ops: readonly string[];
    readonly observedPaymentInstruction: boolean;
    readonly observedEventItSelector: boolean;
  };
  readonly dependencies: readonly {
    readonly key: string;
    readonly state: string;
    readonly paths: readonly string[];
    readonly contractRequest?: { readonly type: string; readonly targetOwners: readonly string[] };
  }[];
}

interface ManifestDeck {
  readonly id: "rumble-sfd" | "fiora-sfd";
  readonly chosenChampion: string;
  readonly selectedDeck: {
    readonly canonicalIdentityCount: number;
    readonly counts: {
      readonly legend: number;
      readonly champion: number;
      readonly mainDeck: number;
      readonly battlefields: number;
      readonly runes: number;
    };
    readonly entries: readonly {
      readonly zone: "legend" | "champion" | "mainDeck" | "battlefields" | "runes";
      readonly quantity: number;
      readonly canonicalCardId: string;
    }[];
  };
}

interface Manifest {
  readonly scope: { readonly pair: { readonly A: "rumble-sfd"; readonly B: "fiora-sfd" } };
  readonly sources: {
    readonly deckPlan: { readonly sha256: string };
    readonly cardCatalog: { readonly sha256: string };
  };
  readonly acceptance: { readonly seeds: readonly string[] };
  readonly canonicalWhitelist: readonly ManifestCard[];
  readonly decks: readonly ManifestDeck[];
  readonly productionSetup: {
    readonly state: "ready" | "blocked";
    readonly lifecycle: {
      readonly path: string;
      readonly sourceSha256: string;
      readonly testPath: string;
      readonly testSha256: string;
    };
    readonly deckConstruction: {
      readonly counts: {
        readonly legend: number;
        readonly chosenChampion: number;
        readonly mainDeck: number;
        readonly battlefields: number;
        readonly runes: number;
      };
    };
    readonly realProbe: {
      readonly seed: string;
      readonly attemptedGames: number;
      readonly state: "not-run" | "passed" | "blocked";
    };
  };
  readonly effectOrderPolicy: {
    readonly nonUniformPriority: boolean;
    readonly targetRules: { readonly version: string; readonly effectiveDate: string };
    readonly interpretationRules: readonly { readonly rule: string; readonly status: string }[];
  };
  readonly officialEffectOrderEvidence: {
    readonly entries: readonly {
      readonly id: string;
      readonly status: "verified" | "pending" | "blocked";
      readonly canonicalCardId: string;
      readonly m1CardIds: readonly string[];
      readonly assertions: readonly {
        readonly path: string;
        readonly testTitle: string;
        readonly result: "verified" | "partial" | "blocked";
      }[];
      readonly missingEvidence?: string | readonly string[];
    }[];
  };
  readonly cardSourceConflicts: readonly {
    readonly canonicalCardId: string;
    readonly selectedPrintingId: string;
    readonly status: string;
  }[];
  readonly followUpPlan: {
    readonly cardWorkstreams: readonly {
      readonly key: string;
      readonly state: string;
      readonly cards: readonly { readonly canonicalCardId: string; readonly name: string }[];
      readonly dependencies: readonly { readonly key: string; readonly cardFiles: readonly { readonly canonicalCardId: string }[] }[];
    }[];
  };
}

type DetailedManifestCard = ManifestCard;

function readManifest(): Manifest {
  return JSON.parse(readFileSync(fileURLToPath(new URL(
    "../../../../docs/plans/m1-two-precons-manifest.json", import.meta.url,
  )), "utf8")) as Manifest;
}

function repositoryPath(relative: string): string {
  return fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(overrides: Partial<M1GameEvidence> = {}): M1GameEvidence {
  return {
    caseIndex: 0,
    seed: "fixture-seed",
    decks: { A: "rumble-sfd", B: "fiora-sfd" },
    orientation: "rumble-a",
    termination: "winner",
    guardReason: null,
    winner: "A",
    scores: { A: 8, B: 3 },
    victoryScore: 8,
    battleStats: { showdowns: 1, combats: 1, attacks: 1, defenses: 1, conquers: 1, scores: 1, points: 8 },
    committedBattleEvents: [],
    eventCount: 10,
    journalDigest: "journal",
    projectionDigests: { A: "a", B: "b" },
    spectatorProjectionDigest: "spectator",
    replayMatches: true,
    freshWorldReplayMatches: true,
    privacySafe: true,
    privacyChecks: 3,
    exceptions: [],
    blockers: [],
    concedeCommands: 0,
    naturalTermination: true,
    ...overrides,
  };
}

describe("RIFT-857 two-precon acceptance", () => {
  it("pins exactly 100 unique seeds, 50 games per seat orientation, and only the approved pair", () => {
    expect(M1_ACCEPTANCE_PLAN).toHaveLength(M1_ACCEPTANCE_GAMES);
    expect(new Set(M1_ACCEPTANCE_PLAN.map(value => value.seed))).toHaveLength(100);
    expect(M1_ACCEPTANCE_PLAN.filter(value => value.orientation === "rumble-a")).toHaveLength(M1_ACCEPTANCE_GAMES_PER_SIDE);
    expect(M1_ACCEPTANCE_PLAN.filter(value => value.orientation === "fiora-a")).toHaveLength(M1_ACCEPTANCE_GAMES_PER_SIDE);
    for (const value of M1_ACCEPTANCE_PLAN) {
      expect(new Set([value.decks.A, value.decks.B])).toEqual(new Set(["rumble-sfd", "fiora-sfd"]));
      expect(value.decks.A).toBe(value.orientation === "rumble-a" ? "rumble-sfd" : "fiora-sfd");
      expect(value.decks.B).toBe(value.orientation === "rumble-a" ? "fiora-sfd" : "rumble-sfd");
    }
  });

  it("preserves the exact official deck shape and printed null costs", () => {
    const manifest = readManifest();
    const whitelist = new Map(manifest.canonicalWhitelist.map(card => [card.canonicalCardId, card]));
    expect(manifest.scope.pair).toEqual({ A: "rumble-sfd", B: "fiora-sfd" });
    expect(manifest.sources.deckPlan.sha256).toBe("17227200ed8b5db2f09cd5e7e05949b72c7c13bdab50ac1e954739c76b14ff04");
    expect(manifest.sources.cardCatalog.sha256).toBe("06d99a589fed6046bff8072847946d5304a8ca43ef1e4e2c680c4a7a0f1df766");
    expect(whitelist).toHaveLength(51);
    expect(sha256(JSON.stringify([...whitelist.keys()].sort()))).toBe(
      "ba94d4805a8ecf16e3e7958c9e6411642c7a52eeaf572c2851afdab1247f794b",
    );
    const deckIdentityUnion = new Set(manifest.decks.flatMap(deck =>
      deck.selectedDeck.entries.map(entry => entry.canonicalCardId)));
    expect(deckIdentityUnion).toEqual(new Set(whitelist.keys()));
    const expectedDeckIdentityHashes = {
      "rumble-sfd": "557c2b7f848d1337ed2a83ba4e0ac2007f392b6347f95a20809af7cac53f8834",
      "fiora-sfd": "7d9e699d2edad4514ce750943584355c078d91db21c269c14c5413bc288d5820",
    } as const;
    const expectedDeckEntryHashes = {
      "rumble-sfd": "027252ac57241e23610136be56298e373d409771d44df43a7867dc8fba8741c5",
      "fiora-sfd": "b93f81407815a7f4aa9de8ab973e7dea71f99da32258bda7bee0ac60f3b314a0",
    } as const;
    for (const approved of manifest.decks) {
      const identities = [...new Set(approved.selectedDeck.entries.map(entry => entry.canonicalCardId))].sort();
      expect(approved.selectedDeck.canonicalIdentityCount).toBe(identities.length);
      expect(sha256(JSON.stringify(identities))).toBe(expectedDeckIdentityHashes[approved.id]);
      const entries = approved.selectedDeck.entries.map(({ zone, quantity, canonicalCardId }) =>
        ({ zone, quantity, canonicalCardId }));
      expect(sha256(JSON.stringify(entries))).toBe(expectedDeckEntryHashes[approved.id]);
    }
    expect(manifest.acceptance.seeds).toEqual(M1_ACCEPTANCE_PLAN.map(value => value.seed));
    for (const card of manifest.canonicalWhitelist) {
      expect(sha256(readFileSync(repositoryPath(card.program.path))), card.program.path).toBe(card.program.sha256);
      expect(sha256(readFileSync(repositoryPath(card.goldens.independent.path))), card.goldens.independent.path)
        .toBe(card.goldens.independent.sha256);
      for (const template of card.goldens.templates) {
        expect(sha256(readFileSync(repositoryPath(template.path))), template.path).toBe(template.sha256);
      }
    }
    for (const approved of manifest.decks) {
      const deck = buildM1Deck(approved.id, approved.id === "rumble-sfd" ? "A" : "B");
      expect(deck.mainDeck).toHaveLength(approved.selectedDeck.counts.mainDeck);
      expect(deck.mainDeck).toHaveLength(39);
      expect(deck.runeDeck).toHaveLength(approved.selectedDeck.counts.runes);
      expect(deck.runeDeck).toHaveLength(12);
      expect(deck.battlefields).toHaveLength(approved.selectedDeck.counts.battlefields);
      expect(deck.battlefields).toHaveLength(3);
      expect(approved.selectedDeck.counts.champion).toBe(1);
      expect(approved.selectedDeck.counts.legend).toBe(1);
      const chosen = whitelist.get(deck.chosenChampion.cardId!);
      expect(chosen, `${approved.id} chosen champion`).toBeDefined();
      expect(chosen!.name).toBe(approved.chosenChampion);
      const deckCards = [deck.championLegend, deck.chosenChampion, ...deck.mainDeck, ...deck.runeDeck, ...deck.battlefields];
      for (const card of deckCards) {
        const manifestCard = whitelist.get(card.cardId!);
        expect(manifestCard, card.name).toBeDefined();
        expect(card.energy).toBe(manifestCard!.printed.energy);
        expect(card.power).toBe(manifestCard!.printed.power);
      }
    }
  });

  it("binds the complete selected deck setup from the real lifecycle input", () => {
    for (const [id, seat] of [["rumble-sfd", "A"], ["fiora-sfd", "B"]] as const) {
      const deck = buildM1Deck(id, seat);
      expect(deck.mainDeck).toHaveLength(39);
      expect(deck.runeDeck).toHaveLength(12);
      expect(deck.battlefields).toHaveLength(3);
      expect(deck.chosenChampion.id).toBe(`${seat}:champion:0:${deck.chosenChampion.cardId}`);
      expect(deck.championLegend.id).toBe(`${seat}:legend:0:${deck.championLegend.cardId}`);
      expect(deck.mainDeck.every(card => card.id.startsWith(`${seat}:mainDeck:`))).toBe(true);
      expect(deck.runeDeck.every(card => card.id.startsWith(`${seat}:runes:`))).toBe(true);
      expect(deck.battlefields.every(card => card.id.startsWith(`${seat}:battlefields:`))).toBe(true);
    }
  });

  it("derives the Fiora IR boundary from the real program and production ports", async () => {
    const manifest = readManifest();
    const card = manifest.canonicalWhitelist.find(value => value.name === "Fiora, Worthy");
    expect(card).toBeDefined();
    if (card === undefined) return;
    const program = await import(
      new URL("../../../../packages/card-dsl/dist/cards/sfd/fiora-worthy.js", import.meta.url).href
    );
    const abilities = program.default.abilities as readonly {
      readonly kind: string;
      readonly body: readonly { readonly op: string }[];
    }[];
    expect(abilities.map(ability => ability.kind)).toEqual(card.ir.abilityKinds);
    expect(abilities.flatMap(ability => ability.body.map(instruction => instruction.op))).toEqual(card.ir.ops);
    expect(card.ir.observedPaymentInstruction).toBe(false);
    expect(card.ir.observedEventItSelector).toBe(false);

    const before = { might: 4, ref: { id: "fiora-unit", zoneEntryId: 7 }, zone: "board",
      types: ["unit"], controller: "A" };
    const after = { might: 5, ref: { id: "fiora-unit", zoneEntryId: 7 }, zone: "board",
      types: ["unit"], controller: "A" };
    const { matchesMightyTransition } = await import(
      new URL("../../../../packages/engine-core/dist/events/pipeline-match.js", import.meta.url).href
    );
    const { costPayArgsToCostSpec } = await import(
      new URL("../../../../packages/engine-core/dist/programs/trigger-adapters/finalize-cost.js", import.meta.url).href
    );
    expect(matchesMightyTransition(true, before, after)).toBe(true);
    expect(matchesMightyTransition(true, after, { ...after, might: 6 })).toBe(false);
    expect(matchesMightyTransition(true, before, { ...after, ref: { ...after.ref, zoneEntryId: 8 } })).toBe(false);
    expect(costPayArgsToCostSpec({ power: { kind: "constant", value: ["Order"] } })).toEqual({
      payments: [{ kind: "power", amount: { kind: "constant", value: 1 }, allowedDomains: ["Order"] }],
    });
  });

  it("does not count blocked, guard, concession, replay failure, or privacy failure as natural", () => {
    const natural = fixture();
    expect(isNaturalM1Game(natural)).toBe(true);
    expect(isNaturalM1Game(fixture({ termination: "blocked", winner: null }))).toBe(false);
    expect(isNaturalM1Game(fixture({ termination: "guard", winner: null, guardReason: "turn-limit" }))).toBe(false);
    expect(isNaturalM1Game(fixture({ termination: "concede", concedeCommands: 1 }))).toBe(false);
    expect(isNaturalM1Game(fixture({ replayMatches: false }))).toBe(false);
    expect(isNaturalM1Game(fixture({ freshWorldReplayMatches: false }))).toBe(false);
    expect(isNaturalM1Game(fixture({ privacySafe: false }))).toBe(false);
    expect(isNaturalM1Game(fixture({ exceptions: ["boom"] }))).toBe(false);
    expect(isNaturalM1Game(fixture({ blockers: [{ name: "Blocked", code: "judge-required", message: "no" }] }))).toBe(false);

    const aggregate = aggregateM1Evidence([
      natural,
      fixture({ caseIndex: 1, termination: "blocked", winner: null, naturalTermination: false }),
      fixture({ caseIndex: 2, termination: "guard", winner: null, guardReason: "turn-limit", naturalTermination: false }),
      fixture({ caseIndex: 3, termination: "concede", winner: "A", concedeCommands: 1, naturalTermination: false }),
      fixture({ caseIndex: 4, replayMatches: false, naturalTermination: false }),
      fixture({ caseIndex: 5, freshWorldReplayMatches: false, naturalTermination: false }),
      fixture({ caseIndex: 6, privacySafe: false, naturalTermination: false }),
    ]);
    expect(aggregate.attemptedGames).toBe(7);
    expect(aggregate.naturalGames).toBe(1);
    expect(aggregate.nonNaturalGames).toBe(6);
    expect(aggregate.passed).toBe(false);
    expect(aggregate.terminationReasons).toEqual({ winner: 4, concede: 1, blocked: 1, exception: 0, guard: 1 });
    expect(aggregate.replayMismatches).toBe(1);
    expect(aggregate.freshWorldReplayMismatches).toBe(1);
    expect(aggregate.privacyLeaks).toBe(1);
    expect(aggregate.concessionGames).toBe(1);
  });

  it("keeps every official effect-order interaction in the M1 whitelist with a source-backed result", () => {
    const manifest = readManifest();
    const whitelist = new Set(manifest.canonicalWhitelist.map(card => card.canonicalCardId));
    expect(manifest.effectOrderPolicy.nonUniformPriority).toBe(true);
    expect(manifest.effectOrderPolicy.targetRules).toEqual(expect.objectContaining({
      version: "1.5",
      effectiveDate: "2026-10-16",
    }));
    expect(manifest.effectOrderPolicy.interpretationRules.map(rule => rule.rule)).toEqual(
      expect.arrayContaining(["CR 002", "CR 051", "CR 054.1", "CR 303.2.a"]),
    );
    expect(manifest.officialEffectOrderEvidence.entries.map(entry => entry.id)).toEqual(expect.arrayContaining([
      "priority-focus-response-windows",
      "cost-selection-targets-payment",
      "replacement-prevent-ordering",
      "layer-dependencies",
      "simultaneous-trigger-order",
      "pending-finalize-resolve",
      "target-loss-ignored-negated-linked-lki",
      "chronobreak-303-2a-no-global-fifo-lifo",
    ]));
    for (const entry of manifest.officialEffectOrderEvidence.entries) {
      if (!["general", "card.hash-2875b065844462e761acfeb152cf2feea180924a496740b05903caac24a3d795"].includes(entry.canonicalCardId)) {
        expect(whitelist.has(entry.canonicalCardId), entry.id).toBe(true);
      }
      for (const cardId of entry.m1CardIds) expect(whitelist.has(cardId), entry.id).toBe(true);
      expect(entry.assertions.length, entry.id).toBeGreaterThan(0);
      for (const assertion of entry.assertions) {
        expect(["verified", "partial", "blocked"]).toContain(assertion.result);
        expect(() => readFileSync(repositoryPath(assertion.path), "utf8"), `${entry.id}: ${assertion.path}`).not.toThrow();
      }
      if (entry.status !== "verified") expect(entry.missingEvidence, entry.id).toBeTruthy();
    }
    expect(manifest.cardSourceConflicts).toEqual([]);
  });

  it("keeps Fiora, Worthy blocked on its real IR and shared production ports", () => {
    const manifest = readManifest();
    const fioraWorthy: ManifestCard | undefined = manifest.canonicalWhitelist.find(card => card.name === "Fiora, Worthy");
    expect(fioraWorthy).toEqual(expect.objectContaining({
      canonicalCardId: "card.hash-261f97a75639fd51dc63b8c4b2a577b52d5bd6893227a1a3a13da5375880fe6f",
      verificationStatus: "contract-request-required",
      productionAcceptance: "pending",
    }));
    expect(fioraWorthy!.evidenceGap).toMatch(/triggered-optional-order-power-finalize/);
    expect(fioraWorthy!.ir).toEqual(expect.objectContaining({
      abilityKinds: ["triggered"],
      ops: ["effect.ready"],
      observedPaymentInstruction: false,
      observedEventItSelector: false,
    }));
    expect(fioraWorthy!.dependencies.map(dependency => dependency.key)).toEqual(expect.arrayContaining([
      "might-changed-becomes-mighty-trigger-binding",
      "triggered-optional-order-power-finalize",
      "event-it-authoritative-bridge",
    ]));
    expect(fioraWorthy!.dependencies.find(dependency => dependency.key === "triggered-optional-order-power-finalize"))
      .toEqual(expect.objectContaining({
        state: "contract-request-required",
        contractRequest: expect.objectContaining({
          type: "additive-ir-and-wire-contract",
          targetOwners: ["parent-contract-owner", "engine-core-finalize-owner"],
        }),
      }));
    expect(manifest.productionSetup.lifecycle.path).toBe("packages/engine-core/src/programs/lifecycle.ts");
    expect(sha256(readFileSync(repositoryPath(manifest.productionSetup.lifecycle.path))))
      .toBe(manifest.productionSetup.lifecycle.sourceSha256);
    expect(sha256(readFileSync(repositoryPath(manifest.productionSetup.lifecycle.testPath))))
      .toBe(manifest.productionSetup.lifecycle.testSha256);
    expect(manifest.productionSetup.deckConstruction.counts).toEqual({
      legend: 1, chosenChampion: 1, mainDeck: 39, battlefields: 3, runes: 12,
    });
    if (manifest.productionSetup.state === "ready") {
      expect(manifest.productionSetup.realProbe).toEqual(expect.objectContaining({
        seed: "RIFT-857-m1-seed-001",
        attemptedGames: 1,
        state: "passed",
      }));
    } else {
      expect(manifest.productionSetup.realProbe).toEqual(expect.objectContaining({
        seed: "RIFT-857-m1-seed-001",
        attemptedGames: 1,
        state: "blocked",
      }));
    }
    const fioraWorkstream = manifest.followUpPlan.cardWorkstreams.find(workstream =>
      workstream.key === "status-not-proof-fiora-and-mighty");
    expect(fioraWorkstream).toEqual(expect.objectContaining({ state: "dependency-not-ready" }));
    expect(fioraWorkstream!.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalCardId: fioraWorthy!.canonicalCardId, name: "Fiora, Worthy" }),
    ]));
    for (const key of [
      "might-changed-becomes-mighty-trigger-binding",
      "triggered-optional-order-power-finalize",
      "event-it-authoritative-bridge",
    ]) {
      expect(fioraWorkstream!.dependencies.find(dependency => dependency.key === key)!.cardFiles)
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ canonicalCardId: fioraWorthy!.canonicalCardId }),
        ]));
    }
  });

  it("stops after one explicit probe and returns its real blocked journal evidence", () => {
    const probe = probeM1Acceptance();
    expect(probe.expectedGames).toBe(100);
    expect(probe.attemptedGames).toBe(1);
    expect(probe.passed).toBe(false);
    expect(probe.results).toHaveLength(1);
    const result = probe.results[0];
    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(result).toEqual(expect.objectContaining({
      caseIndex: 0,
      seed: "RIFT-857-m1-seed-001",
      decks: { A: "rumble-sfd", B: "fiora-sfd" },
      termination: "blocked",
      winner: null,
      replayMatches: true,
      freshWorldReplayMatches: true,
      privacySafe: true,
      naturalTermination: false,
    }));
    expect(result.blockers).toEqual([
      expect.objectContaining({ name: "ProgramBindingError", code: "judge-required" }),
    ]);
    expect(probe.naturalGames).toBe(0);
  }, 30_000);

  it("keeps every M1 card bound to a preserved independent golden", () => {
    const manifest = readManifest();
    const summaries: string[] = [];
    for (const card of manifest.canonicalWhitelist) {
      expect(card.goldens.independent.path).toMatch(/^packages\/card-dsl\/test\/cards\/.*\.test\.mjs$/);
      expect(card.goldens.independent.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(card.program.path).toMatch(/^packages\/card-dsl\/src\/cards\/.*\.ts$/);
      expect(card.goldenExecution.observedAt).toMatch(/^2026-10-19T/);
      expect(card.goldenExecution.pass).toBeGreaterThan(0);
      expect(["unproven", "complete"]).toContain(card.goldenExecution.wholeCardStatus);
      expect(card.goldenExecution.exitCode === 0).toBe(card.goldenExecution.fail === 0);
      summaries.push(`${card.name}: pass=${card.goldenExecution.pass} todo=${card.goldenExecution.todo}`);
    }
    expect(summaries).toHaveLength(51);
  }, 120_000);
});
