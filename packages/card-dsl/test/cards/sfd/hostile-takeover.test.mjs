import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/hostile-takeover.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import control from "../../../../engine-core/dist/effects/instructions/effect.control.js";
import move from "../../../../engine-core/dist/effects/instructions/effect.move.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { isTimingPointId } from "../../../../engine-core/dist/events/timing-points.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
// Card bodies run through the chain's own interpreter adapter — the production
// entry point that re-wraps Expr arguments for the registered primitives.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-62970334aded475305f68e3c9c4e769ce6ebe07ff91a0030017c68594309466e";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Take control of an enemy unit at a battlefield. Ready it. " +
  "(Start a combat if other enemies are there. Otherwise, conquer.)\n" +
  "Lose control of that unit and recall it at end of turn. " +
  "(Send it to base. This isn't a move.)";

const [hiddenKeyword, playAbility] = program.abilities;
const [takeControl, readyIt, delayedRevert] = playAbility.body;
const unitSpec = takeControl.targets[0];
const delayedBody = delayedRevert.args.body.value;
const [loseControl, recall] = delayedBody;

/** Mirrors chain/engine.ts's query normalization of "self"/"opponent". */
function chainKernel(kernel) {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") {
              kernelFilter[playerKey] = target.controller;
            } else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== target.controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

// Only the supported prefix runs: the delayed-ability registration has no merged
// opcode (registering it would throw), so the body is executed up to that point.
const supportedBody = playAbility.body
  .filter((instruction) => instruction.op !== "trigger.delayed")
  .map(({ targets, ...instruction }) => instruction);

/** A battlefield-resident defending unit with its Finalize-locked target set. */
function scenario({ exhausted = true } = {}) {
  const locked = world()
    .unit("enemy-unit", {
      owner: "B",
      controller: "B",
      types: ["unit"],
      might: 3,
      exhausted,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const kernel = locked.clone({ sourceSnapshot: locked.getObject("enemy-unit") });
  kernel.setTargets(unitSpec.id, [kernel.ref("enemy-unit")]);
  return kernel;
}

test("sfd-202-221 Hostile Takeover: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-202-221 Hostile Takeover: judgeReason names all three current gaps and their rules", () => {
  // README section 2: each gap must name the missing form, the rule basis and
  // the dependent work. The earlier RIFT-261/RIFT-91/RIFT-9/RIFT-109 wording is
  // gone because those tasks are merged; the reason now names the merged
  // consumers that still refuse the shapes this card needs.
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /facedown/);
  assert.match(program.judgeReason, /hidden-cleanup-state/);
  assert.match(program.judgeReason, /811\.1\.b/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /391\.2/);
  assert.match(program.judgeReason, /393/);
  assert.match(program.judgeReason, /457-460/);
  assert.match(program.judgeReason, /effect\.move/);
  // The reason must be honest about the delayed control write-back too.
  assert.match(program.judgeReason, /479\.2\.a/);
  // No merged task is still named as an outstanding dependency.
  assert.doesNotMatch(program.judgeReason, /RIFT-(9|89|90|91|109|257|258|261)\b/);
});

test("sfd-202-221 Hostile Takeover structure: [Hidden] plus control, ready and a delayed revert", () => {
  assert.equal(program.abilities.length, 2);
  // 811: the keyword is a pure permission and carries no value.
  assert.deepEqual(hiddenKeyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(hiddenKeyword.value, undefined);

  assert.equal(playAbility.kind, "play");
  assert.equal(playAbility.cost, undefined);
  assert.deepEqual(playAbility.body.map((instruction) => [instruction.id, instruction.op]), [
    ["hostile-takeover.take-control", "effect.control"],
    ["hostile-takeover.ready", "effect.ready"],
    ["hostile-takeover.delayed-revert", "trigger.delayed"]
  ]);

  // "Take control of an enemy unit at a battlefield": one opponent-controlled
  // Board unit at a battlefield (355.7/355.9.a.1/355.9.b); the location is a
  // restriction (355.10.b). The control change itself is the frozen
  // take-control GameAction through the merged effect.control.
  assert.deepEqual(takeControl.args, {
    objects: { kind: "constant", value: { target: "hostile-takeover.unit" } },
    linkKey: { kind: "constant", value: "controlled" }
  });
  assert.deepEqual(unitSpec, {
    id: "hostile-takeover.unit",
    filter: { type: "unit", controller: "opponent", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(takeControl.linkedTo, undefined);

  // "Ready it.": the same chosen unit (contract 3.6 symbolic selector), and
  // deliberately NOT linked to the control instruction (359.3.e.14.b).
  assert.deepEqual(readyIt.args, {
    objects: { kind: "constant", value: { kind: "target", id: "hostile-takeover.unit" } },
    amount: { kind: "constant", value: 1 },
    linkKey: { kind: "constant", value: "readied" }
  });
  assert.equal(readyIt.linkedTo, undefined);
  assert.equal(readyIt.targets, undefined);

  // "Lose control of that unit and recall it at end of turn.": the merged
  // whole-set shape is not used — the card is a Delayed Ability (391.2/392/393),
  // recorded as the pending trigger.delayed instruction for an end-of-turn
  // window (359.3.e.16's own example is this card).
  assert.equal(delayedRevert.op, "trigger.delayed");
  assert.deepEqual(delayedRevert.args.at, { kind: "constant", value: "turn-end" });
  assert.equal(isTimingPointId(delayedRevert.args.at.value), true);
  assert.deepEqual(delayedRevert.args.window, { kind: "constant", value: "this-turn" });
  assert.equal(delayedRevert.args.body.kind, "constant");

  // The delayed body hands control back to the receipt's owner and then recalls.
  // "that unit" is the same TargetSpec read back through a symbolic selector.
  assert.deepEqual(loseControl.args.objects, {
    kind: "constant",
    value: { target: "hostile-takeover.unit" }
  });
  assert.deepEqual(loseControl.args.player, {
    kind: "object-property",
    object: { linked: "hostile-takeover.take-control" },
    property: "owner"
  });

  // "recall it": a Recall (457), never a Move (458) — effect.move's recall mode.
  assert.equal(recall.op, "effect.move");
  assert.equal(recall.linkedTo, "hostile-takeover.lose-control");
  assert.deepEqual(recall.args.objects, {
    kind: "constant",
    value: { target: "hostile-takeover.unit" }
  });
  assert.deepEqual(recall.args.to, { kind: "constant", value: "controller-base" });
  assert.deepEqual(recall.args.mode, { kind: "constant", value: "recall" });
  assert.equal(recall.targets, undefined);

  // "(Start a combat if other enemies are there. Otherwise, conquer.)" is reminder
  // text: 135.2.d.3 gives it no rules effect, so no branch is programmed for it.
  assert.equal(playAbility.body.length, 3);

  assert.equal(instructionDefinitionsById.get("effect.control"), control);
  assert.equal(instructionDefinitionsById.get("effect.ready"), ready);
  assert.equal(instructionDefinitionsById.get("effect.move"), move);
  assert.equal(keywordDefinitionsById.has("Hidden"), true);
});

test("sfd-202-221 Hostile Takeover: the declared dependencies are the judgeReason's named gaps", () => {
  // The merged Hidden expansion is the cost.hidden static effect (811), and the
  // card's own delayed clause is the pending trigger.delayed instruction; the
  // judgeReason names both missing consumers (the layerFor mapping for
  // cost.hidden, the unregistered delayed-trigger opcode) instead of a generic
  // "not implemented".
  assert.equal(keywordDefinitionsById.get("Hidden").expand()[0].effect.kind, "cost.hidden");
  assert.equal(keywordDefinitionsById.has("Reaction"), true);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /trigger\.delayed/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("sfd-202-221 Hostile Takeover: the merged Hidden expansion is refused by the production static binder", () => {
  // 811/811.1.b: [Hidden] expands to the static cost.hidden effect. The merged
  // production binder (programs/statics.ts layerFor) has no layer for that kind,
  // so it fails closed instead of granting a pretend Hide permission. This is
  // the executed evidence for gap (1) in the judgeReason.
  const kernel = world()
    .unit("host", {
      cardId: CARD_ID,
      types: ["spell"],
      zone: "hand",
      location: null
    })
    .build();
  const source = kernel.getObject("host");
  const layers = createLayerEngine([source]);
  const binder = createEngineStaticBinder({ layers });
  const [expansion] = keywordDefinitionsById.get("Hidden").expand();
  assert.equal(expansion.effect.kind, "cost.hidden");
  assert.throws(
    () => binder.bindStatic(expansion, source),
    /Static ability kind cost\.hidden has no layer mapping/
  );
  assert.deepEqual(layers.registry.list(), []);
});

test("sfd-202-221 Hostile Takeover: the delayed half still has no card-facing instruction", () => {
  // 391.2/392/393: the end-of-turn half is a Delayed Ability, so it may only be
  // recorded through a registered trigger.delayed op. The merged instruction
  // registry has no such entry, so the declared instruction cannot execute.
  assert.equal(instructionDefinitionsById.has("trigger.delayed"), false);
  assert.equal(instructionDefinitionsById.get(delayedRevert.op), undefined);
  assert.match(program.judgeReason, /registry\.generated\.ts 无该条目/);
});

test("sfd-202-221 Hostile Takeover golden: control changes the unit and then readies it", () => {
  const kernel = scenario();
  const outcome = resolveChainBody(supportedBody, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["hostile-takeover.take-control", "executed"],
      ["hostile-takeover.ready", "executed"]
    ]
  );
  // 127.1: the owner is unchanged by a control change.
  assert.equal(kernel.getObject("enemy-unit").controller, "A");
  assert.equal(kernel.getObject("enemy-unit").owner, "B");
  assert.equal(kernel.getObject("enemy-unit").exhausted, false);
  assert.deepEqual(outcome.linkedValues["hostile-takeover.take-control.controlled"], {
    count: 1,
    objects: [{ id: "enemy-unit", zoneEntryId: 1 }],
    changes: [{ object: { id: "enemy-unit", zoneEntryId: 1 }, owner: "B", from: "B", to: "A" }]
  });
  assert.deepEqual(kernel.events.map((event) => event.action), ["take-control", "ready"]);
});

test("sfd-202-221 Hostile Takeover golden: an already-readied unit is not readied again (416.1.c)", () => {
  const kernel = scenario({ exhausted: false });
  const outcome = resolveChainBody(supportedBody, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").controller, "A");
  assert.equal(kernel.getObject("enemy-unit").exhausted, false);
  // Only the control action is observed: 416.1.b/416.1.c make the ready a no-op.
  assert.deepEqual(kernel.events.map((event) => event.action), ["take-control"]);
  assert.deepEqual(outcome.linkedValues["hostile-takeover.ready.readied"], { count: 0, objects: [] });
});

test("sfd-202-221 Hostile Takeover golden: the ready still executes when the control half cannot (359.3.e.11)", () => {
  // The control primitive refuses a non-permanent duration (the card's delayed
  // half needs duration-aware take-control); the ready is an independent sentence
  // and still readies the unit.
  const kernel = scenario();
  const controlWithDuration = {
    ...takeControl,
    args: {
      ...takeControl.args,
      duration: { kind: "constant", value: { type: "end-of-turn" } }
    }
  };
  const outcome = resolveChainBody(
    [
      { ...controlWithDuration, targets: undefined },
      { ...readyIt }
    ].map(({ targets, ...instruction }) => instruction),
    chainKernel(kernel)
  );

  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status, entry.result.reason]),
    [
      ["hostile-takeover.take-control", "negated", "impossible"],
      ["hostile-takeover.ready", "executed", undefined]
    ]
  );
  // No substitute action: the controller never changes, and the receipt reports
  // the blocked reason instead of pretending a temporary control happened.
  assert.equal(kernel.getObject("enemy-unit").controller, "B");
  assert.equal(kernel.getObject("enemy-unit").exhausted, false);
  assert.match(
    outcome.linkedValues["hostile-takeover.take-control.controlled"].blockedReason,
    /479\.2\.a|482\.3/
  );
});

test("sfd-202-221 Hostile Takeover golden: the merged recall path refuses to fake a Move (457/458)", () => {
  // effect.move documents Recall as explicitly BLOCKED: the frozen move-location
  // action cannot distinguish a Recall from a Move (457, 458.3, 460), so a nonzero
  // recall reports negated/impossible with a blockedReason rather than relocating.
  const kernel = world()
    .unit("enemy-unit", {
      owner: "B",
      controller: "A",
      location: { type: "battlefield", id: "battlefield-1" },
      might: 3,
      damage: 2
    })
    .build();
  const run = runInstruction(
    move,
    { objects: recall.args.objects, to: recall.args.to, mode: recall.args.mode },
    { world: kernel, targets: { [unitSpec.id]: [kernel.ref("enemy-unit")] } }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.linked.moved.count, 0);
  assert.equal(run.linked.moved.blockedReason.length > 0, true);
  const after = kernel.getObject("enemy-unit");
  assert.deepEqual(after.location, { type: "battlefield", id: "battlefield-1" });
  assert.equal(after.damage, 2);
  assert.equal(after.controller, "A");
  assert.deepEqual(kernel.events.map((event) => event.action), []);
});

test("sfd-202-221 Hostile Takeover: the 'at a battlefield' restriction matches battlefields only", () => {
  const snapshot = (location) => ({
    ref: { id: "unit", zoneEntryId: 1 },
    cardId: "card:unit",
    name: "unit",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "B",
    controller: "B",
    zone: "board",
    location,
    might: 3,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  });
  const { controller: _opponentController, ...locationOnly } = unitSpec.filter;
  assert.equal(matchesObjectFilter(locationOnly, snapshot({ type: "battlefield", id: "battlefield-1" })), true);
  assert.equal(matchesObjectFilter(locationOnly, snapshot({ type: "base", player: "B" })), false);
  assert.equal(matchesObjectFilter(locationOnly, snapshot(null)), false);

  // "enemy unit" runs through the chain's own query normalization: the caster's
  // own unit never qualifies.
  const kernel = world()
    .unit("own-unit", { owner: "A", controller: "A", location: { type: "battlefield", id: "battlefield-1" } })
    .unit("their-unit", { owner: "B", controller: "B", location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  assert.deepEqual(
    chainKernel(kernel)
      .query({ type: "unit", controller: unitSpec.filter.controller })
      .map((object) => object.ref.id),
    ["their-unit"]
  );
});

test.todo(
  "sfd-202-221 Hostile Takeover: the [Hidden] half — Hide now for :rb_rune_rainbow: and the facedown play " +
    "for :rb_energy_0: with its later Reaction timing — needs a layer/consumer for the expanded static " +
    "cost.hidden (programs/statics.ts layerFor refuses it), a facedown ZoneId, and the Hide action wiring " +
    "(cost/kinds/hidden.ts locks only the plan)"
);

test.todo(
  "sfd-202-221 Hostile Takeover: register the end-of-turn Delayed Ability (CR 391.2/392/393, and 359.3.e.16's " +
    "own Hostile Takeover example) through a card-facing trigger.delayed instruction, instead of a " +
    "card-owned passive trigger"
);

test.todo(
  "sfd-202-221 Hostile Takeover: restore the previous controller at end of turn in timestamp order " +
    "(CR 479.2.a / 482.3) — effect.control documents that non-permanent take-control durations stay blocked " +
    "until duration-aware control and layered expiry exist"
);

test.todo(
  "sfd-202-221 Hostile Takeover: a real Recall (CR 457-460: relocate to the controller's Base, not a Move, no " +
    "Move triggers, ignore movement restrictions, keep damage and statuses) needs a Recall action distinct from " +
    "move-location, which effect.move documents as BLOCKED"
);
