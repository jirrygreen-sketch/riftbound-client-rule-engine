import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/bone-skewer.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import play from "../../../../engine-core/dist/effects/instructions/effect.play.js";
import reveal from "../../../../engine-core/dist/effects/instructions/effect.reveal.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { registryById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import costModify from "../../../../engine-core/dist/effects/instructions/cost.modify.js";

/** Minimal engine so the production static binder can be exercised directly. */
function binderFor(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: (request) => { throw new Error(`Unexpected choice: ${request.id}`); },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  return createEngineStaticBinder(engine);
}

const CANONICAL_ID =
  "card.hash-5726eb484767a4425aeceb77e181b534986492340b0bc94c0bcf8d4ae478d598";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Choose a battlefield. An opponent reveals their hand. You may choose a unit from it. " +
  "They play that unit to that battlefield, ignoring any and all costs. When they do, [Stun] it. " +
  "(It doesn't deal combat damage this turn.)";

const [hiddenKeyword, play2] = program.abilities;
const [battlefieldInstruction, chooseOpponent, revealInstruction, mayPlay] = play2.body;
const [playInstruction] = mayPlay.args.body.value;

test("unl-139-219 Bone Skewer: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-139-219 Bone Skewer: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // README section 2: each gap names the missing piece and the governing rule.
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(89|9|120|257)/);
  assert.match(program.judgeReason, /356\.5\.a/);
  assert.match(program.judgeReason, /388\.1/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-139-219 Bone Skewer: [Hidden], printed cost and the four printed clauses in order", () => {
  // 811: declared as a keyword ability only; the expansion (cost.hidden) is the
  // keyword registry's job (README section 5).
  assert.deepEqual(hiddenKeyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(hiddenKeyword.value, undefined);

  assert.equal(play2.kind, "play");
  assert.deepEqual(play2.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play2.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["bone-skewer.battlefield", "condition.value"],
      ["bone-skewer.choose-opponent", "target.player"],
      ["bone-skewer.reveal-opponent-hand", "effect.reveal"],
      ["bone-skewer.may-play-chosen-unit", "choice.optional"]
    ]
  );
});

test("unl-139-219 Bone Skewer: the battlefield is a target and the opponent choice is the unmerged player selection", () => {
  // "Choose a battlefield": a specific Game Object in a public zone
  // (170 / 170.7 / 355.10.a.1), so it is targeted (355.7).
  assert.deepEqual(battlefieldInstruction.targets, [
    {
      id: "bone-skewer.battlefield",
      filter: { type: "battlefield" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // The read that later instructions could consume; static IR cannot hold a
  // runtime LocationRef, so only the object value is bound here.
  assert.deepEqual(battlefieldInstruction.args.key, { kind: "constant", value: "battlefield" });
  assert.deepEqual(battlefieldInstruction.args.value, {
    kind: "object-property",
    object: { target: "bone-skewer.battlefield" },
    property: "ref"
  });

  // "An opponent": no merged player-selection primitive; declared with the
  // ogn/mindsplitter target.player shape (see judgeReason).
  assert.equal(chooseOpponent.op, "target.player");
  assert.deepEqual(chooseOpponent.args.selection, { kind: "constant", value: "one" });
  assert.deepEqual(chooseOpponent.args.chooser, { kind: "constant", value: "controller" });
  assert.deepEqual(chooseOpponent.args.linkKey, { kind: "constant", value: "chosenOpponent" });
  assert.equal(chooseOpponent.targets, undefined);
});

test("unl-139-219 Bone Skewer: the reveal is the whole hand of the chosen opponent (425.3.a)", () => {
  assert.equal(revealInstruction.op, "effect.reveal");
  assert.equal(revealInstruction.linkedTo, "bone-skewer.choose-opponent");
  assert.deepEqual(revealInstruction.args.player, {
    kind: "linked-value",
    instructionId: "bone-skewer.choose-opponent",
    key: "chosenOpponent"
  });
  assert.deepEqual(revealInstruction.args.zone, { kind: "constant", value: "hand" });
  // 425.3.a: no printed count reveals every card currently in the zone.
  assert.equal(revealInstruction.args.count, undefined);
  assert.equal(revealInstruction.targets, undefined);
  assert.equal(revealInstruction.picks, undefined);
});

test("unl-139-219 Bone Skewer: the may clause wraps the play in choice.optional (contract 3.9)", () => {
  // "You may choose a unit from it" is a "may" clause: contract 3.9 freezes the
  // shape as choice.optional with the chosen instructions inside body - never a
  // choice followed by a linkedTo successor.
  assert.equal(mayPlay.op, "choice.optional");
  assert.equal(mayPlay.linkedTo, "bone-skewer.reveal-opponent-hand");
  assert.equal(mayPlay.args.body.kind, "constant");
  assert.deepEqual(mayPlay.args.body.value.map((instruction) => instruction.id), [
    "bone-skewer.play-chosen-unit"
  ]);

  assert.equal(playInstruction.op, "effect.play");
  // The chosen card comes from the revealed hand: a non-target pick
  // (355.10.a / 355.10.e), with the options read from the reveal's result.
  assert.deepEqual(playInstruction.args.pick, {
    kind: "constant",
    value: "bone-skewer.chosen-unit-card"
  });
  assert.deepEqual(playInstruction.picks, [
    {
      id: "bone-skewer.chosen-unit-card",
      options: [
        {
          kind: "linked-value",
          instructionId: "bone-skewer.reveal-opponent-hand",
          key: "revealed"
        }
      ],
      filter: { zone: "hand", type: "unit" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // "to that battlefield" is a runtime LocationRef read from the chosen
  // battlefield; "ignoring any and all costs" is CR 356.5.a's total-cost
  // rewrite (356.5.a). Both are declared as descriptive markers that the
  // merged effect.play rejects (see the fail-closed test and judgeReason).
  assert.deepEqual(playInstruction.args.location, {
    kind: "constant",
    value: {
      kind: "location-selector",
      from: { target: "bone-skewer.battlefield" }
    }
  });
  assert.deepEqual(playInstruction.args.cost, {
    kind: "constant",
    value: {
      kind: "cost.modify",
      base: "printed",
      ignore: ["any", "all"],
      minimum: 0,
      finalized: false
    }
  });
});

test("unl-139-219 Bone Skewer golden: revealing the chosen opponent's hand lists every card (425.3.a)", () => {
  const kernel = world()
    .hand("b1", { owner: "B" })
    .hand("b2", { owner: "B" })
    .hand("a1", { owner: "A" })
    .build();
  // target.player has no merged implementation, so the opponent choice is bound
  // through its linked value exactly as the merged mindsplitter golden does.
  kernel.link("bone-skewer.choose-opponent.chosenOpponent", "B");

  const outcome = resolveChainBody([(({ linkedTo, ...rest }) => rest)(revealInstruction)], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.revealed, [
    { id: "b1", zoneEntryId: 1 },
    { id: "b2", zoneEntryId: 1 }
  ]);
  // 425.1.a.2: the revealed cards stay in their zone; 425.2.a: only the chosen
  // player's hand is revealed.
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["b1", "b2"]);
  assert.deepEqual(kernel.zone("A", "hand").map((ref) => ref.id), ["a1"]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["reveal", "reveal"]);
});

test("unl-139-219 Bone Skewer golden: a non-target pick from the revealed hand stays a pick (355.10.a/e)", () => {
  const kernel = world().hand("u1", { owner: "B", types: ["unit"] }).build();
  kernel.setPicks("bone-skewer.chosen-unit-card", [kernel.ref("u1")]);

  // The pick is read through ctx.picks and is never treated as a target: the
  // primitive reports no target-set result and the card is untouched.
  const run = runInstruction(reveal, { pick: "bone-skewer.chosen-unit-card" }, {
    world: kernel,
    picks: { "bone-skewer.chosen-unit-card": [kernel.ref("u1")] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("u1").zone, "hand");
});

test("unl-139-219 Bone Skewer fail-closed: the merged effect.play refuses the unrunnable location and cost markers", () => {
  const kernel = world().hand("u1", { owner: "B", types: ["unit"] }).build();
  const ref = kernel.ref("u1");

  // The location marker is not a base/battlefield LocationRef, so the primitive
  // negates instead of guessing a destination; the cost marker is not a
  // finalized FinalizedCostPlan, so "ignoring any and all costs" (356.5.a) is
  // never silently replaced by the printed cost either.
  const run = runInstruction(
    play,
    {
      pick: "bone-skewer.chosen-unit-card",
      location: playInstruction.args.location,
      cost: playInstruction.args.cost,
      linkKey: "played"
    },
    { world: kernel, picks: { "bone-skewer.chosen-unit-card": [ref] } }
  );

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  // The card stayed in hand: no play happened and no cost was paid.
  assert.equal(kernel.getObject("u1").zone, "hand");
  assert.deepEqual(kernel.events, []);
});

test("Bone Skewer: the Hidden marker binds into the production capability registry", () => {
  // 811: Hidden expands to one static cost.hidden capability. The Hide action's
  // own timing and free facedown play remain separate consumers.
  const hidden = keywordDefinitionsById.get("Hidden");
  assert.ok(hidden, "effects/keywords/Hidden.ts must be registered");
  assert.deepEqual(hidden.expand(), [{ kind: "static", effect: { kind: "cost.hidden" } }]);

  const kernel = world()
    .unit("skewer", { types: ["spell"], owner: "A", controller: "A" })
    .build();
  const source = kernel.getObject("skewer");
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main",
    host: {
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: checkpoint => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose: request => { throw new Error(`Unexpected choice: ${request.id}`); },
      context: (sourceObject, controller, timingPoint) => bindResolveContext(kernel, { source: sourceObject, controller, timingPoint })
    },
    cleanup: () => false
  });
  const handle = createEngineStaticBinder(engine).bindStatic(hidden.expand()[0], source);
  const [registration] = engine.layers.registry.list();
  assert.equal(registration.effect.id, "program-hidden:skewer:1:0");
  assert.equal(registration.effect.effect.kind, "static.capability");
  assert.equal(registration.effect.effect.capabilityKind, "hidden");
  handle.unbind();
});

test("Bone Skewer: the registered player choice waits for an opponent selection", () => {
  // 355.7 / 355.9.a: "An opponent" reaches target.player and the production
  // interpreter asks for the Finalize player choice.
  assert.equal(registryById.has("target.player"), true);
  assert.equal(registryById.has("trigger.reflexive"), true);
  const kernel = world()
    .unit("skewer", { types: ["spell"], owner: "A", controller: "A" })
    .object("bf-1", { owner: "A", controller: "A", types: ["battlefield"], zone: "board", location: null })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("skewer") });
  scoped.setTargets("bone-skewer.battlefield", [kernel.ref("bf-1")]);
  assert.throws(() => resolveChainBody([battlefieldInstruction, chooseOpponent], scoped), error => error.name === "AwaitChoice");
});

test("Bone Skewer: the chain adapter decodes ignore-all-costs into a zero total", () => {
  // 356.5.a: "ignoring any and all costs" sets the total cost to [0]. The merged
  // cost.modify exposes ignoreAllCosts, but the chain adapter does not decode its
  // declared literal arguments, so the interpreter path cannot produce that
  // plan: the Expr-wrapped id/ignoreAllCosts reach the primitive as objects and
  // it throws. The primitive does accept plain evaluated values, which is what a
  // future adapter would have to supply.
  const kernel = world()
    .unit("skewer", { types: ["spell"], owner: "A", controller: "A" })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("skewer") });
  const outcome = resolveChainBody([
    {
      id: "bone-skewer.ignore-costs",
      op: "cost.modify",
      args: { id: { kind: "constant", value: "ignore" }, ignoreAllCosts: { kind: "constant", value: true } }
    }
  ], scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["bone-skewer.ignore-costs.cost"].total, {
    energy: 0,
    power: [],
    xp: 0,
    actions: []
  });
  const direct = runInstruction(costModify, { id: "ignore", ignoreAllCosts: true }, { world: kernel });
  assert.equal(direct.result.status, "executed");
  assert.deepEqual(direct.linked.cost.total, { energy: 0, power: [], xp: 0, actions: [] });
});

test.todo(
  "Bone Skewer: [Hidden] (CR 811) needs its cost.hidden consumer - the Hide action, facedown-zone restrictions " +
    "and the free facedown play are not consumed by the merged Hidden KeywordDef, which only declares the static effect"
);

test.todo(
  "Bone Skewer: \"They play that unit ... ignoring any and all costs\" is CR 356.5.a's total-cost rewrite, which needs a " +
    "finalized zero-cost plan produced by the cost system (effect.play never derives printed costs)"
);

test.todo(
  "Bone Skewer: \"When they do, [Stun] it\" is a Reflexive Trigger (CR 388.1 / 388.2 / 389.1), which creates its own " +
    "Pending Item after the play; no merged form creates one (trigger.reflexive, ogn/dragons-rage-lee-sin records the same gap)"
);

test.todo(
  "Bone Skewer: \"An opponent\" needs the target.player player-selection primitive plus the location read of the chosen " +
    "battlefield (target.location); the golden binds the opponent through its linked value in the meantime (ogn/mindsplitter)"
);
