import assert from "node:assert/strict";
import test from "node:test";

import program from "../../../dist/cards/sfd/laurent-duelist.js";
import { validateCardProgram } from "../../../dist/ir/validation.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { CombatFlow } from "../../../../engine-core/dist/combat/flow.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

const CARD_ID = "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6";
const CORE_URL =
  "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf";
const RADIANCE_URL =
  "https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/";
const SFD_ERRATA_URL =
  "https://playriftbound.com/en-us/news/rules-and-releases/riftbound-spiritforged-errata/";
const BATTLEFIELD = { type: "battlefield", id: "bf1" };

// Source snapshots are pinned under shared/rules/official-order. Neither the
// Radiance rulings nor the Spiritforged errata contains a Laurent/Assault rule.
const OFFICIAL_EVIDENCE = Object.freeze({
  contract: "riftbound.official-effect-order-evidence.v1",
  canonicalCardId: CARD_ID,
  sources: Object.freeze({
    coreRules: Object.freeze({
      version: "1.5",
      dated: "2026-10-09",
      effective: "2026-10-16",
      url: CORE_URL,
      localSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
    }),
    radianceRulings: Object.freeze({
      published: "2026-10-09",
      effective: "2026-10-16",
      url: RADIANCE_URL,
      applicableToThisCard: false,
      result: "reviewed: no Laurent Duelist or Assault-specific ruling; CR v1.5 governs"
    }),
    spiritforgedErrata: Object.freeze({
      published: "2026-01-14",
      effective: null,
      url: SFD_ERRATA_URL,
      applicableToThisCard: false,
      result: "reviewed: no Laurent Duelist or Assault correction"
    })
  }),
  interaction: Object.freeze({
    canonicalCardId: CARD_ID,
    sourceText: "[Assault 2] (+2 :rb_might: while I'm an attacker.)",
    ruleRefs: Object.freeze([
      "337.1.b", "338.1", "340.1", "466.2.c.1", "466.2.c.2", "466.2.c.3",
      "467.2", "468.7.a", "478.2", "478.4", "479.4.e.1",
      "807.1.c", "807.1.d", "807.1.d.1"
    ]),
    priorityFocus:
      "Combat opens at CR 466.2. The Attacker gains Focus as the Combat Showdown opens (466.2.c.1.a); Laurent supplies no numeric priority or extra timing permission.",
    responseWindow:
      "The card has no Play or activated ability and no optional additional cost. A Reaction remains governed by the ordinary Chain Execute window (CR 338.1 / 340.1).",
    replacement: "Laurent supplies no replacement or prevention effect, so CR 054.1 has no applicable branch.",
    pendingFinalizeResolve:
      "The real judge-required ProgramBinding fails before Play, so no cost is paid and no Chain item is created. The separately bound original Assault expansion proves the implemented layer path without claiming whole-card execution.",
    layers:
      "Assault 2 is a +2 arithmetic-layer increase (807.1.c / 479.4.e.1), continuously gated by Attacker designation; CR 478.2/478.4 requires one application per effect.",
    lki:
      "The static modifier reads the exact live incarnation and designation. CR 468.7.a removes that designation at Combat end, so no stale bonus survives.",
    simultaneousTriggers:
      "Laurent has no triggered ability. CombatFlow emits attack-declared and defense-declared in one designation batch, while Assault itself is continuous and not a Chain item.",
    timeline: Object.freeze([
      "Play/Pending -> Finalize: the actual judge-required program is refused; no resource or Chain item changes.",
      "Combat start: CR 466.2.c.3 gives Laurent Attacker or Defender without mutating the base host snapshot.",
      "Continuous layer read: attacker Might is printed 3 + Assault 2 = 5; defender and non-Combat Might remain 3.",
      "Damage: CR 467.2 requires current Might 5. The current full Play/lifecycle probe exposes 7 at damage.ts:166-167; this is the unresolved production gate.",
      "Combat end: CR 468.7.a removes the designation and the modifier stops applying."
    ]),
    productionAssertions: Object.freeze([
      "ProgramBinding fail-closed: judge-required Laurent is refused before cost or Chain mutation",
      "partial production golden: original expansion plus real CombatFlow gives Attacker Might 5 and Defender/non-Combat Might 3"
    ])
  })
});

const snapshot = (combatRole = null) => ({
  ref: { id: "duelist", zoneEntryId: 1 },
  cardId: CARD_ID,
  name: "Laurent Duelist",
  types: ["unit"],
  tags: ["Demacia"],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: BATTLEFIELD,
  combatRole,
  might: 3,
  energy: 4,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

test("program passes validation and remains judge-required with the current defect", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /combat\/transactions\/damage\.ts:166/);
  assert.match(program.judgeReason, /第 167 行/);
  assert.match(program.judgeReason, /attackerMight 实测为 7/);
  assert.match(program.judgeReason, /467\.2/);
  assert.equal(program.sourceText, "[Assault 2] (+2 :rb_might: while I'm an attacker.)");
});

test("identity and keyword shape: exactly one Assault 2 declaration", () => {
  assert.equal(program.abilities.length, 1);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "assault", value: 2 });
});

test("ProgramBinding expands Assault into the attacker-only Might layer (807.1.c)", () => {
  const inspected = createProgramBinding({ cardPrograms: [program] }).inspect(snapshot());
  assert.equal(inspected.abilities.length, 2);
  const [assault] = inspected.abilities.filter((ability) => ability.kind === "static");
  assert.equal(assault.effect.kind, "continuous.might");
  assert.equal(assault.effect.mode, "add");
  assert.deepEqual(assault.effect.amount, { kind: "constant", value: 2 });
  assert.deepEqual(assault.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
});

test("official CR, Radiance and Spiritforged evidence is pinned", () => {
  assert.deepEqual(OFFICIAL_EVIDENCE.sources.coreRules, {
    version: "1.5",
    dated: "2026-10-09",
    effective: "2026-10-16",
    url: CORE_URL,
    localSha256: "bbc81327eb21242452db3c56348b0725b1e0b6186c1a682dde541f3c7a864ba2"
  });
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.effective, "2026-10-16");
  assert.equal(OFFICIAL_EVIDENCE.sources.radianceRulings.applicableToThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.sources.spiritforgedErrata.applicableToThisCard, false);
  assert.equal(OFFICIAL_EVIDENCE.canonicalCardId, program.canonicalCardId);
  assert.deepEqual(OFFICIAL_EVIDENCE.interaction.ruleRefs, [
    "337.1.b", "338.1", "340.1", "466.2.c.1", "466.2.c.2", "466.2.c.3",
    "467.2", "468.7.a", "478.2", "478.4", "479.4.e.1",
    "807.1.c", "807.1.d", "807.1.d.1"
  ]);
});

function hostFor(kernel, choose) {
  return createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    performContract: (action) => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: (registration) => kernel.test(registration.spec.condition)
  });
}

function combatRuntime(laurentRole) {
  const laurentController = laurentRole === "defender" ? "B" : "A";
  const otherController = laurentController === "A" ? "B" : "A";
  const builder = world().player("A").player("B")
    .unit("laurent", {
      cardId: CARD_ID,
      name: "Laurent Duelist",
      types: ["unit"],
      tags: ["Demacia"],
      keywords: [],
      owner: laurentController,
      controller: laurentController,
      might: 3,
      energy: 4,
      power: null,
      location: BATTLEFIELD
    })
    .unit("other", {
      owner: otherController,
      controller: otherController,
      types: ["unit"],
      tags: [],
      keywords: [],
      might: 4,
      power: null,
      location: BATTLEFIELD
    });
  const kernel = builder.build();
  const choose = (request) => {
    if (request.type === "mode" && request.id.startsWith("engagement:")) return request.options[0];
    if (request.type === "order") return [request.options[0]];
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new AwaitChoice(request);
  };
  const host = hostFor(kernel, choose);
  const chain = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  const combat = new CombatFlow(chain, host,
    [{ id: "bf1", controller: "B" }, { id: "bf2", controller: null }],
    () => {}, { events: true, lifecycle: true });
  const source = kernel.getObject("laurent");
  const binding = createProgramBinding({ cardPrograms: [program] });
  const assault = binding.inspect(source).abilities.find((ability) => ability.kind === "static");
  assert.ok(assault);
  const handle = createEngineStaticBinder(chain).bindStatic(assault, source);
  return { kernel, chain, combat, binding, handle };
}

function startCombat(f) {
  const source = f.kernel.getObject("laurent");
  const entrant = source.controller === "A" ? source : f.kernel.getObject("other");
  assert.equal(f.combat.entered(entrant).length, 1);
  assert.equal(f.combat.cleanup(), true);
  f.chain.advance();
  return f.combat.startCombat("bf1");
}

function layerMight(f, id = "laurent") {
  return f.chain.layers.snapshot(f.kernel.ref(id))?.might;
}

test("production boundary: judge-required program is refused before Play", () => {
  const kernel = world().player("A").unit("laurent", {
    cardId: CARD_ID,
    types: ["unit"],
    keywords: [],
    zone: "hand",
    energy: 4,
    power: null,
    might: 3
  }).build();
  const binding = createProgramBinding({ cardPrograms: [program] });
  const source = kernel.getObject("laurent");
  assert.throws(
    () => binding.describePlay({ type: "play", object: source.ref, player: "A" }, source),
    (error) => error?.code === "judge-required" && error.message === program.judgeReason
  );
  assert.equal(kernel.getObject("laurent").zone, "hand");
});

test("production partial golden: Attacker designation makes original Assault layer give 5", () => {
  const f = combatRuntime("attacker");
  assert.equal(layerMight(f), 3);
  assert.deepEqual(startCombat(f), {
    field: "bf1", combatId: "combat:bf1:1", attacker: "A", defender: "B", focus: "A"
  });
  const laurent = f.kernel.getObject("laurent");
  assert.equal(f.combat.snapshot(laurent).combatRole, "attacker");
  assert.equal(layerMight(f), 5);
  assert.equal(laurent.might, 3);
  assert.equal(laurent.combatRole, null);
  assert.equal(
    f.chain.hostObjects().find((object) => object.ref.id === "laurent")?.combatRole,
    "attacker"
  );
  assert.deepEqual(
    f.chain.pipeline.events.filter((event) =>
      ["combat-start", "attack-declared", "defense-declared"].includes(event.timingPoint)
    ).map((event) => event.timingPoint),
    ["combat-start", "attack-declared", "defense-declared"]
  );
  f.handle.unbind();
});

test("production boundary: Defender and non-Combat Laurent remain Might 3", () => {
  const nonCombat = combatRuntime(null);
  assert.equal(nonCombat.combat.snapshot(nonCombat.kernel.getObject("laurent")).combatRole, null);
  assert.equal(layerMight(nonCombat), 3);
  nonCombat.handle.unbind();

  const defender = combatRuntime("defender");
  assert.deepEqual(startCombat(defender), {
    field: "bf1", combatId: "combat:bf1:1", attacker: "A", defender: "B", focus: "A"
  });
  const laurent = defender.kernel.getObject("laurent");
  assert.equal(defender.combat.snapshot(laurent).combatRole, "defender");
  assert.equal(layerMight(defender), 3);
  assert.equal(laurent.combatRole, null);
  defender.handle.unbind();
});
