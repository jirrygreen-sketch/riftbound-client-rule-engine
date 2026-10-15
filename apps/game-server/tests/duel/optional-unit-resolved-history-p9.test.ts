import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime, validateCatalogDeck } from "../../src/card-catalog.js";
import {
  createDuelRecordedRuntimeP4,
  createDuelReplayGateP4,
  digestDuelCommandArchiveP4,
  replayDuelCommandArchiveP4,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_PHYSICAL_CHAIN as P8,
  DUEL_RUNTIME_PROFILE_P4_OPTIONAL_UNIT_RESOLVED_HISTORY as P9,
  type DuelCommandArchiveP4,
} from "../../src/duel/command-journal-p4.js";

type DuelSeat = { readonly playerId: string; readonly displayName: string; readonly deck: any };
type Entropy = { readonly kind: "random"; readonly bound: number; readonly value: number } |
  { readonly kind: "uid"; readonly value: string };
type SeedOperation = { readonly actor: string; readonly packet: unknown; readonly entropy: readonly Entropy[] };
type Seed = {
  readonly source: Record<string, string | number>;
  readonly matchId: string;
  readonly seats: readonly [DuelSeat, DuelSeat];
  readonly creationEntropy: readonly Entropy[];
  readonly operations: readonly SeedOperation[];
  readonly decline: { readonly actor: string; readonly packet: any };
};

const seedPath = new URL("./fixtures/native-main5-command-seed.json", import.meta.url);
const catalog = await loadCardCatalogRuntime();

/** Deterministic entropy drive for the actual server owner. Every recorded
 * random/uid draw is consumed strictly in order and checked to be exhausted at
 * each operation boundary; the live suffix uses fresh generators because those
 * commands never existed in the original GUI journal. */
function createDriven(seed: Seed, profile: typeof P8 | typeof P9) {
  let expected: readonly Entropy[] = seed.creationEntropy;
  let cursor = 0, live = false, extra = 0;
  const take = (kind: Entropy["kind"], bound?: number): string | number => {
    if (live) return kind === "uid" ? `native-main5-p9-live-${++extra}` : 0;
    const entry = expected[cursor++];
    if (!entry || entry.kind !== kind) throw new TypeError(`entropy kind mismatch at ${cursor - 1}`);
    if (kind === "random" && (entry.kind !== "random" || entry.bound !== bound))
      throw new TypeError(`entropy bound mismatch at ${cursor - 1}`);
    return entry.value;
  };
  const options = { catalog, matchId: seed.matchId, roster: seed.seats,
    randomIndex: (bound: number) => take("random", bound) as number,
    uidFactory: () => take("uid") as string };
  const recorded = createDuelRecordedRuntimeP4(options, profile);
  const runtime = recorded.runtime;
  const exhausted = (label: string) => {
    if (cursor !== expected.length) throw new TypeError(`${label}: unused entropy ${cursor}/${expected.length}`);
  };
  const runPrefix = () => {
    exhausted("creation");
    for (const operation of seed.operations) {
      expected = operation.entropy; cursor = 0;
      const ack = runtime.dispatch(operation.actor, operation.packet).ack;
      expect(ack.ok).toBe(true);
      exhausted("operation");
    }
  };
  return { options, recorded, runtime, runPrefix, goLive: () => { live = true; } };
}

function projectSeed(): Seed {
  return JSON.parse(readFileSync(seedPath, "utf8")) as Seed;
}

function digestGate(options: unknown, archive: DuelCommandArchiveP4, profile: typeof P8 | typeof P9) {
  return createDuelReplayGateP4(options as any, digestDuelCommandArchiveP4(archive), profile);
}

describe("native Main5 decline regression under resolved-history P9", () => {
  const seed = projectSeed();
  expect(seed.source.kind).toBe("actual-native-gui-journal-seed");
  expect(seed.source.originalSchemaVersion).toBe(8);
  expect(seed.operations).toHaveLength(27);
  for (const seat of seed.seats) expect(validateCatalogDeck(catalog, seat.deck).valid).toBe(true);

  it("keeps the legacy P8 owner blocked at 87 after the retired battle", async () => {
    const drive = createDriven(seed, P8);
    drive.runPrefix();
    drive.goLive();
    expect(drive.runtime.project("player-1").match.stateVersion).toBe(87);
    const before = drive.runtime.project("player-1").match.stateVersion;
    const decline = drive.runtime.dispatch(seed.decline.actor, seed.decline.packet);
    expect(decline.ack).toMatchObject({ type: "blocked", pending: true });
    expect(drive.runtime.project("player-1").match.stateVersion).toBe(before);

    const archive = drive.recorded.archive();
    expect(archive.schemaVersion).toBe(8);
    expect(archive.profile).toBe(P8);
    expect(() => replayDuelCommandArchiveP4(archive, digestGate(drive.options, archive, P9)))
      .toThrow(/profile/);
  }, 180_000);

  it("re-executes the same 27 inputs plus decline at 88, pays to 92 and re-verifies strictly", async () => {
    const drive = createDriven(seed, P9);
    drive.runPrefix();
    drive.goLive();
    const actor = seed.decline.actor;
    expect(drive.runtime.project(actor).match.stateVersion).toBe(87);

    const decline = drive.runtime.dispatch(actor, seed.decline.packet);
    expect(decline.ack).toMatchObject({ type: "request-result", ok: true, appliedVersion: 88, eventSeq: 88 });
    const projected = drive.runtime.project(actor).match;
    expect(projected.frame.pendingPayment?.resolvedCost).toEqual({ energy: 2, power: [] });

    let sequence = 0;
    const send = (command: unknown) => {
      const id = `native-main5-p9-command-${++sequence}`;
      const packet = { type: "duel-command", commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
        requestId: id, commandId: id, expectedVersion: drive.runtime.project(actor).match.stateVersion, command };
      return { packet, result: drive.runtime.dispatch(actor, packet) };
    };
    for (let index = 0; index < 2; index++) {
      const action = drive.runtime.project(actor).actions
        .find(value => value.kind === "rune-energy" && value.enabled);
      if (!action || action.kind !== "rune-energy") throw new TypeError("real energy Rune required");
      expect(send({ type: "rune-energy", uid: action.uid }).result.ack)
        .toMatchObject({ type: "request-result", ok: true, appliedVersion: 89 + index });
    }
    const pay = drive.runtime.project(actor).actions
      .find(value => value.kind === "pay-pending" && value.enabled);
    if (!pay || pay.kind !== "pay-pending") throw new TypeError("real payment action required");
    const paid = send({ type: "pay-pending", paymentId: pay.paymentId });
    expect(paid.result.ack).toMatchObject({ type: "request-result", ok: true, appliedVersion: 92, eventSeq: 92 });

    const final = drive.runtime.project(actor).match;
    expect(final.stateVersion).toBe(92);
    expect(final.frame.chain.active).toBe(false);
    expect(final.frame.execution.status).toBe("ready");
    const unitUID = (seed.operations[26]!.packet as any).command.cardUID as string;
    const unit = final.board.units.find(value => value.objectId === unitUID);
    expect(unit?.readied).toBe(false);
    expect(unit?.locationId).toBe(final.board.bases.find(base => base.ownerPlayerId === actor)?.locationId);
    expect(final.players.find(player => player.playerId === actor)!.hand!.some(card => card.uid === unitUID))
      .toBe(false);

    // A duplicate pay-pending must not pay a second time.
    const duplicate = drive.runtime.dispatch(actor, paid.packet).ack;
    expect(duplicate.duplicate).toBe(true);
    expect(drive.runtime.project(actor).match.stateVersion).toBe(92);

    // Strict private replay equality plus an explicit wrong-profile gate refusal.
    const started = Date.now();
    const journal = drive.recorded.archive();
    expect(journal.schemaVersion).toBe(9);
    expect(journal.profile).toBe(P9);
    const digest = digestDuelCommandArchiveP4(journal);
    const restored = replayDuelCommandArchiveP4(journal, createDuelReplayGateP4(drive.options, digest, P9));
    expect(restored.archive()).toEqual(journal);
    expect(() => replayDuelCommandArchiveP4(journal, createDuelReplayGateP4(drive.options, digest, P8)))
      .toThrow(/profile/);
    const elapsedMs = Date.now() - started;
    expect(elapsedMs).toBeLessThan(180_000);
    console.log(JSON.stringify({ nativeMain5P9StrictReplayMs: elapsedMs }));
  }, 180_000);
});
