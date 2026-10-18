import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sudden-storm.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL = "card.hash-574418734c3b92b767c220f89099980a68fad40a1074ee6c38bc88c7efb84771";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Deal 2 to a unit at a battlefield. If it's attacking, deal 4 to it instead.";

const [hidden, action, play] = program.abilities;
const [dealTwo, dealFour] = play.body;
const targetSpec = dealTwo.targets[0];

test("sfd-017-221 Sudden Storm: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-017-221 Sudden Storm: judge-required only for Hidden's unresolved permission", () => {
  assert.equal(program.status, "judge-required");
  // The reason must credit the merged surfaces it relies on...
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /has no layer mapping/);
  assert.match(program.judgeReason, /facedown/);
  // ...and must not present the printed [Action] admission as missing: the
  // declaration drives the real chain's timing, and its own expansion is a
  // separate, still-unbound static.
  assert.match(program.judgeReason, /Action/);
  assert.match(program.judgeReason, /abilitySpeed/);
  assert.match(program.judgeReason, /Action is not legally timed/);
  assert.match(program.judgeReason, /Unsupported static appliesTo/);
  assert.doesNotMatch(program.judgeReason, /combatRole.*未|combatRole.*缺/);
});

test("sfd-017-221 Sudden Storm: both printed permission keywords fail to bind in production", () => {
  // Live evidence for judgeReason: [Hidden] expands to a cost.hidden static that
  // has no layer mapping, and [Action] to a continuous.timing whose appliesTo
  // list the static binder rejects. Neither printed permission is installed.
  const kernel = world().player("A", { energy: 20 }).player("B", { energy: 20 })
    .object("storm", {
      name: "Sudden Storm",
      cardId: CANONICAL,
      types: ["spell"],
      zone: "hand",
      energy: 3,
      power: []
    })
    .deck(["A:deck:1", "A:deck:2"])
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: () => { throw new Error("the permission evidence must not require a choice"); },
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host });
  const source = kernel.getObject("storm");
  const binder = createEngineStaticBinder(engine);

  assert.throws(
    () => binder.bindStatic(keywordDefinitionsById.get("Hidden").expand({ host: { canonicalCardId: CANONICAL } })[0], source),
    /no layer mapping/,
    "[Hidden]'s cost.hidden must stay unconsumed"
  );
  assert.throws(
    () => binder.bindStatic(keywordDefinitionsById.get("Action").expand({ host: { canonicalCardId: CANONICAL } })[0], source),
    /Unsupported static appliesTo/,
    "[Action]'s Showdown permission must stay unbound"
  );
  assert.deepEqual(engine.layers.registry.list(), []);
});

test("sfd-017-221 Sudden Storm structure: [Hidden] + [Action] and the two guarded amounts", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  // Catalog printed cost: 3 energy, no printed Power (never rewritten as 0).
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.deepEqual(play.body.map((instruction) => instruction.id), [
    "sudden-storm.deal-2",
    "sudden-storm.deal-4"
  ]);

  // "a unit at a battlefield": one Board unit whose location is a battlefield
  // (355.10.b: the battlefield itself is not targeted).
  assert.deepEqual(targetSpec, {
    id: "sudden-storm.unit-at-battlefield",
    filter: { type: "unit", zone: "board" },
    location: { type: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "Deal 2": the printed amount for a unit that is not an attacker.
  assert.equal(dealTwo.op, "effect.damage");
  assert.deepEqual(dealTwo.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(dealTwo.args.target, {
    kind: "constant",
    value: "sudden-storm.unit-at-battlefield"
  });
  assert.equal(dealTwo.linkedTo, undefined);
  assert.deepEqual(dealTwo.condition, {
    kind: "not",
    condition: {
      kind: "compare",
      left: {
        kind: "object-property",
        object: { target: "sudden-storm.unit-at-battlefield" },
        property: "combatRole"
      },
      operator: "eq",
      right: { kind: "constant", value: "attacker" }
    }
  });

  // "If it's attacking, deal 4 to it instead": the replacement amount for the
  // same chosen unit (359.3.e.14 makes "it" a reference, hence the link).
  assert.equal(dealFour.op, "effect.damage");
  assert.equal(dealFour.linkedTo, "sudden-storm.deal-2");
  assert.deepEqual(dealFour.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(dealFour.targets, [targetSpec]);
  assert.equal(dealFour.condition.kind, "compare");
  assert.equal(dealFour.condition.operator, "eq");
  assert.deepEqual(dealFour.condition.left, {
    kind: "object-property",
    object: { target: "sudden-storm.unit-at-battlefield" },
    property: "combatRole"
  });
  assert.deepEqual(dealFour.condition.right, { kind: "constant", value: "attacker" });
});

test("sfd-017-221 Sudden Storm golden: combatRole selects exactly one printed damage branch", () => {
  for (const [combatRole, expected] of [[null, 2], ["attacker", 4]]) {
    const kernel = world().unit("branch-unit", {
      owner: "B",
      controller: "B",
      might: 5,
      combatRole,
      location: { type: "battlefield", id: "battlefield-1" }
    }).build();
    kernel.setTargets(targetSpec.id, [kernel.ref("branch-unit")]);
    const outcome = resolveChainBody(play.body, kernel);
    assert.equal(outcome.status, "partial");
    assert.equal(kernel.getObject("branch-unit").damage, expected);
    assert.equal(outcome.results.filter((entry) => entry.result.status === "executed").length, 1);
  }
});

test("sfd-017-221 Sudden Storm golden: the printed 2 damage reaches the locked battlefield unit", () => {
  // The golden runs the printed amount branch directly through the merged
  // damage primitive; the condition itself reads ObjectSnapshot.combatRole.
  // target is locked through the kernel (the pit-rookie convention: the
  // reference kernel cannot re-run the card's richer target filter).
  const kernel = world().unit("battlefield-unit", { owner: "B", might: 4 }).build();
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("battlefield-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("battlefield-unit").damage, 2);
  assert.equal(run.result.linkedValues.dealt, 2);
  assert.equal(run.result.linkedValues.dealtCount, 1);
  assert.deepEqual(run.events.map((event) => event.action), ["damage"]);
});

test("sfd-017-221 Sudden Storm golden: the printed 4 damage is a distinct amount, not a doubled 2", () => {
  const kernel = world().unit("attacker-unit", { owner: "B", might: 6 }).build();
  const run = runInstruction(
    damage,
    { amount: dealFour.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("attacker-unit")] } }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("attacker-unit").damage, 4);
  assert.equal(run.result.linkedValues.dealt, 4);
});

test("sfd-017-221 Sudden Storm golden: a stale battlefield target is ignored, not redirected", () => {
  const kernel = world().unit("leaving-unit", { owner: "B", might: 4 }).build();
  const stale = kernel.ref("leaving-unit");
  // The unit left its zone after Finalize (359.3.e.5): its ObjectRef no longer
  // resolves, so the Deal finds no legal target.
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "hand" }).status, "done");
  const run = runInstruction(
    damage,
    { amount: dealTwo.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [stale] } }
  );

  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
  assert.equal(kernel.getObject("leaving-unit").damage, 0);
  assert.equal(kernel.getObject("leaving-unit").zone, "hand");
});

test.todo(
  "sfd-017-221 Sudden Storm: the printed [Hidden] line still needs a production consumer that grants Hide, stores the " +
    "card facedown, and permits its later facedown Reaction play"
);

// Real execution evidence for the printed [Action] permission (806.1.c): the
// declaration alone drives the draft speed, so the merged chain admits the spell
// during a Showdown with Focus and refuses it in an opponent's ordinary Main
// phase. The card's own body then resolves through the production chain.
function actionAdmissionWorld() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .object("storm", {
      name: "Sudden Storm",
      cardId: CANONICAL,
      types: ["spell"],
      zone: "hand",
      energy: 3,
      power: []
    })
    .unit("enemy-unit", { owner: "B", controller: "B", might: 6, location: { type: "battlefield", id: "bf-1" } })
    .deck(["A:d1", "A:d2", "A:d3"])
    .build();
  const choose = (request) => request.type === "select-objects" ? [kernel.ref("enemy-unit")] : (request.options ? request.options[0] : undefined);
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (saved) => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  return { kernel, host };
}

test("sfd-017-221 Sudden Storm golden: the declared [Action] speed is admitted only in a Showdown (806.1.c)", () => {
  const { kernel, host } = actionAdmissionWorld();
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const engine = new ChainEngine({
    turnOrder: ["B", "A"],
    turnPlayer: "B",
    phase: "main",
    host,
    cleanup: () => false,
    describePlay: binding.describePlay
  });

  // 806.1.b grants Showdown play even outside your turn, but it is still a
  // timing permission: in an opponent's ordinary Main phase (no Showdown open)
  // the chain refuses the play.
  const before = kernel.getObject("storm");
  const draft = binding.describePlay({ type: "play", object: before.ref, player: "A" }, before);
  assert.equal(draft.speed, "action");
  assert.throws(() => engine.execute(draft), /Action is not legally timed/);
  assert.equal(engine.items.length, 0);
  assert.equal(kernel.getObject("storm").zone, "hand");

  // 806.1.b/806.1.c: with Focus in a Showdown the same draft is admitted, and
  // the card's printed body resolves for real (2 to the non-attacking unit).
  engine.openShowdown("A");
  const source = kernel.getObject("storm");
  engine.execute(binding.describePlay({ type: "play", object: source.ref, player: "A" }, source));
  assert.deepEqual(engine.items.map((item) => [item.speed, item.status]), [["action", "finalized"]]);
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 20) throw new Error("Nonterminating chain");
    engine.pass(engine.priority);
  }
  assert.equal(kernel.getObject("enemy-unit").damage, 2);
  assert.equal(kernel.getObject("storm").zone, "trash");
  assert.equal(kernel.player("A").energy, 17);
  assert.equal(engine.pipeline.events.some((event) => event.timingPoint === "card-played"), true);
});
