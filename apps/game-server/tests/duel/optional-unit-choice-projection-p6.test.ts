import { describe, expect, it } from "vitest";
import type { DuelOptionalPlayPromptV1 } from "@riftbound/engine-core/duel";
import { isDuelProjectionV3Actions1, DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1,
  type DuelCommandMessageV3Actions1 } from "@riftbound/protocol";
import { loadCardCatalogRuntime } from "../../src/card-catalog.js";
import { createAuthoritativeDuelRuntimeP4 } from "../../src/duel/authoritative-runtime-p4.js";
import { projectOptionalUnitChoiceP6 } from "../../src/duel/optional-unit-choice-projection-p6.js";
import { setupAdapterFixtureCatalog, setupAdapterFixtureDecks } from "./fixtures/setup-adapter-catalog.js";

const prompt = (): DuelOptionalPlayPromptV1 => Object.freeze({
  choiceId: "opaque-choice-1", payOptionId: "opaque-pay-1", declineOptionId: "opaque-decline-1" });
const OPAQUE = "owner-supplied-opaque-prompt-token";
// Synthetic private facts the adapter must never surface; not present in any request below.
const PRIVATE_ACTOR_UID = "alice-hand-uid-42";
const PRIVATE_PROGRAM_FP = "program-fp:ogn-001-298";
const PRIVATE_SOURCE_EPOCH = 7;

const ownKeys = (value: object): string[] => Object.keys(value).sort();

describe("optional-Unit choice projection P6 (pure presentation adapter)", () => {
  it("returns null for an absent prompt and never fabricates a window", () => {
    expect(projectOptionalUnitChoiceP6({ prompt: null, ownerPlayerId: "alice",
      viewerPlayerId: "alice", opaquePromptId: OPAQUE })).toBeNull();
    expect(projectOptionalUnitChoiceP6({ prompt: null, ownerPlayerId: "alice",
      viewerPlayerId: null, opaquePromptId: OPAQUE })).toBeNull();
  });

  it("projects the exact owner DTO with the caller's opaque prompt id and both opaque options", () => {
    const result = projectOptionalUnitChoiceP6({ prompt: prompt(), ownerPlayerId: "alice",
      viewerPlayerId: "alice", opaquePromptId: OPAQUE });
    expect(result).toEqual({ active: true, choiceId: "opaque-choice-1", kind: "play-choices",
      prompts: [{ promptId: OPAQUE, kind: "optional-cost", minSelections: 1, maxSelections: 1,
        options: [{ id: "opaque-pay-1", label: "支付额外费用" },
          { id: "opaque-decline-1", label: "不支付额外费用" }] }] });
    expect(ownKeys(result!)).toEqual(["active", "choiceId", "kind", "prompts"]);
  });

  it("uses exactly the opaque per-prompt token as promptId and never derives it from private facts", () => {
    const first = projectOptionalUnitChoiceP6({ prompt: prompt(), ownerPlayerId: "alice",
      viewerPlayerId: "alice", opaquePromptId: "opaque-A" });
    const second = projectOptionalUnitChoiceP6({ prompt: prompt(), ownerPlayerId: "alice",
      viewerPlayerId: "alice", opaquePromptId: "opaque-B" });
    const promptsOf = (value: unknown) => (value as { prompts: { promptId: string }[] }).prompts;
    expect(promptsOf(first)[0]!.promptId).toBe("opaque-A");
    expect(promptsOf(second)[0]!.promptId).toBe("opaque-B");
    // Only the opaque token changes; nothing derived from UID/fingerprint/epoch appears.
    expect(first).toEqual({ ...second, prompts: [{ ...promptsOf(second)[0]!, promptId: "opaque-A" }] });
  });

  it("shows a non-owner seat exactly {active:true}", () => {
    const result = projectOptionalUnitChoiceP6({ prompt: prompt(), ownerPlayerId: "alice",
      viewerPlayerId: "bob", opaquePromptId: OPAQUE });
    expect(result).toEqual({ active: true });
    expect(ownKeys(result!)).toEqual(["active"]);
  });

  it("shows an anonymous spectator (null viewer) exactly {active:true}", () => {
    const result = projectOptionalUnitChoiceP6({ prompt: prompt(), ownerPlayerId: "alice",
      viewerPlayerId: null, opaquePromptId: OPAQUE });
    expect(result).toEqual({ active: true });
    expect(ownKeys(result!)).toEqual(["active"]);
  });

  it("returns fresh independent DATA so later mutation of the captured DTO cannot leak", () => {
    const mutable = { choiceId: "opaque-choice-1", payOptionId: "opaque-pay-1",
      declineOptionId: "opaque-decline-1" };
    const result = projectOptionalUnitChoiceP6({ prompt: mutable, ownerPlayerId: "alice",
      viewerPlayerId: "alice", opaquePromptId: OPAQUE });
    const snapshot = structuredClone(result);
    mutable.choiceId = "mutated-choice";
    mutable.payOptionId = "mutated-pay";
    expect(result).toEqual(snapshot);
    (result as { prompts: { options: { id: string }[] }[] }).prompts[0]!.options[0]!.id = "handler-mutation";
    const again = projectOptionalUnitChoiceP6({ prompt: { choiceId: "opaque-choice-1",
      payOptionId: "opaque-pay-1", declineOptionId: "opaque-decline-1" }, ownerPlayerId: "alice",
      viewerPlayerId: "alice", opaquePromptId: OPAQUE });
    expect((again as { prompts: { options: { id: string }[] }[] }).prompts[0]!.options[0]!.id)
      .toBe("opaque-pay-1");
  });

  it("carries only opaque tokens and never a receipt, actor UID, program fingerprint or epoch", () => {
    const result = projectOptionalUnitChoiceP6({ prompt: prompt(), ownerPlayerId: "alice",
      viewerPlayerId: "alice", opaquePromptId: OPAQUE });
    const text = JSON.stringify(result);
    for (const privateValue of [PRIVATE_ACTOR_UID, PRIVATE_PROGRAM_FP, String(PRIVATE_SOURCE_EPOCH),
      "receipt", "decision", "actor", "sourceEpoch", "sourceProgramFingerprint", "uid"])
      expect(text).not.toContain(privateValue);
    // A prompt with an unexpected field (e.g. a private UID) is rejected, not copied through.
    expect(() => projectOptionalUnitChoiceP6({ prompt: { ...prompt(), uid: PRIVATE_ACTOR_UID } as never,
      ownerPlayerId: "alice", viewerPlayerId: "alice", opaquePromptId: OPAQUE })).toThrow(TypeError);
  });

  it("rejects malformed identities and prompt fields", () => {
    const base = { prompt: prompt(), ownerPlayerId: "alice", viewerPlayerId: "alice", opaquePromptId: OPAQUE };
    expect(() => projectOptionalUnitChoiceP6({ ...base, ownerPlayerId: "" })).toThrow(TypeError);
    expect(() => projectOptionalUnitChoiceP6({ ...base, opaquePromptId: "  " })).toThrow(TypeError);
    expect(() => projectOptionalUnitChoiceP6({ ...base, viewerPlayerId: "" })).toThrow(TypeError);
    expect(() => projectOptionalUnitChoiceP6({ ...base,
      prompt: { ...prompt(), choiceId: "" } })).toThrow(TypeError);
    expect(() => projectOptionalUnitChoiceP6({ ...base, prompt: null as never,
      ownerPlayerId: "alice" })).not.toThrow();
  });

  it("produces a pending choice that the existing P4 body guard accepts", async () => {
    const catalog = await loadCardCatalogRuntime({ catalog: setupAdapterFixtureCatalog });
    let uid = 0;
    const runtime = createAuthoritativeDuelRuntimeP4({ catalog, matchId: "p6-choice-projection-fixture",
      roster: [
        { playerId: "alice", displayName: "Alice", deck: setupAdapterFixtureDecks.a.submission },
        { playerId: "bob", displayName: "Bob", deck: setupAdapterFixtureDecks.b.submission },
      ], randomIndex: () => 0, uidFactory: () => `p6-choice-${++uid}` });
    for (let n = 0; n < 2; n++) {
      const setup = runtime.project(null);
      if (setup.match.stage !== "setup") throw Error("setup expected");
      const packet: DuelCommandMessageV3Actions1 = { type: "duel-command",
        commandProfile: DUEL_COMMAND_PACKET_PROFILE_V3_ACTIONS_1, requestId: `request-${n}`,
        commandId: `mulligan-${n}`, expectedVersion: setup.match.stateVersion,
        command: { type: "mulligan", selectedUIDs: [] } };
      expect(runtime.dispatch(setup.match.setup.currentMulliganOwner!, packet).ack.ok).toBe(true);
    }
    const ownerView = runtime.project("alice");
    if (ownerView.match.stage !== "playing") throw Error("playing expected");
    const withOwner = { ...ownerView, match: { ...ownerView.match, frame: { ...ownerView.match.frame,
      pendingChoice: projectOptionalUnitChoiceP6({ prompt: prompt(), ownerPlayerId: "alice",
        viewerPlayerId: "alice", opaquePromptId: OPAQUE }) } } };
    expect(isDuelProjectionV3Actions1(withOwner)).toBe(true);
    const spectator = runtime.project("bob");
    if (spectator.match.stage !== "playing") throw Error("playing expected");
    const withSpectator = { ...spectator, match: { ...spectator.match, frame: { ...spectator.match.frame,
      pendingChoice: projectOptionalUnitChoiceP6({ prompt: prompt(), ownerPlayerId: "alice",
        viewerPlayerId: "bob", opaquePromptId: OPAQUE }) } } };
    expect(isDuelProjectionV3Actions1(withSpectator)).toBe(true);
  });
});
