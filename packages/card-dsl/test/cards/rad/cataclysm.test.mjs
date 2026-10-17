import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/cataclysm.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { restrictions } from "../../../../engine-core/dist/layers/rules/query.js";

const CANONICAL = "card.hash-ae044cb9c1012d147e7d25ce802c5abdf9385203d5b3e53601d79a9d830f8472";
const SOURCE_TEXT =
  "Opponents can't play spells this turn.\n" +
  "Move a friendly unit to an occupied enemy battlefield.";

const [play] = program.abilities;
const [restriction, moveInstruction] = play.body;

function registryOf(kernel) {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
}

test("Cataclysm program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Cataclysm identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the actual current gaps: the chain's play/activation
  // permission query does not consume the registered prohibition, and the
  // destination still has no runtime Location selector.
  assert.match(program.judgeReason, /continuous\.restrict/);
  assert.match(program.judgeReason, /RIFT-259/);
  assert.match(program.judgeReason, /canAct/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Cataclysm structure: printed cost, restriction declaration, targeted Move", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");
  // Catalog printing: 4 energy + 1 Body power, no Action/Reaction keyword.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["cataclysm.no-opponent-spells", "continuous.restrict"],
      ["cataclysm.move-unit", "effect.move"]
    ]
  );

  // "Opponents can't play spells this turn" (355.8 / 806 / 159.2) is registered
  // through the merged continuous.restrict instruction (RIFT-259) as an
  // ability-layer prohibition over the opponent's spell plays.
  assert.deepEqual(restriction.args.mode, { kind: "constant", value: "prohibit" });
  assert.deepEqual(restriction.args.action, { kind: "constant", value: "play-spell" });
  assert.deepEqual(restriction.args.appliesTo, {
    kind: "constant",
    value: { controller: "opponent" }
  });
  assert.deepEqual(restriction.args.duration, { kind: "constant", value: "this-turn" });

  // "Move a friendly unit to an occupied enemy battlefield": the moved unit
  // is a target (355.10 / 355.9.a.1); the destination is a runtime battlefield
  // choice (170.11.a occupied) and is described, not executed.
  assert.equal(moveInstruction.linkedTo, undefined);
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "cataclysm.friendly-unit" }
  });
  assert.deepEqual(moveInstruction.args.amount, { kind: "constant", value: 1 });
  assert.equal(moveInstruction.args.to.value.kind, "destination-selector");
  assert.equal(moveInstruction.targets.length, 1);
  assert.equal(moveInstruction.targets[0].id, "cataclysm.friendly-unit");
  assert.deepEqual(moveInstruction.targets[0].filter, {
    type: "unit",
    controller: "controller"
  });
  assert.equal(moveInstruction.targets[0].min, 1);
  assert.equal(moveInstruction.targets[0].max, 1);
  assert.equal(moveInstruction.targets[0].selection, "one");
});

test("Cataclysm golden: the printed prohibition registers an end-of-turn restriction", () => {
  const kernel = world()
    .unit("cataclysm", { owner: "A", zone: "board" })
    .unit("enemy-spell", { owner: "B", controller: "B", types: ["spell"], zone: "chain" })
    .build();
  const outcome = resolveChainBody([restriction], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [["cataclysm.no-opponent-spells", "executed"]]
  );
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  // 478.1.a: the prohibition lives in the ability layer as a restriction entry
  // with the printed action name; "this turn" maps to the end-of-turn duration.
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "restriction");
  assert.deepEqual(registration.effect.effect.actions, ["play-spell"]);
  assert.deepEqual(registration.effect.filter, { controller: "opponent" });
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // The merged rule query reads the prohibition back for exactly the printed
  // actor: an opponent's spell play is restricted; the controller's own play
  // and other actions are not.
  assert.deepEqual(
    restrictions(
      registryOf(kernel),
      "play-spell",
      kernel.ref("enemy-spell"),
      kernel.getObject("enemy-spell"),
      "A"
    ).map((entry) => [entry.kind, entry.actions]),
    [["restriction", ["play-spell"]]]
  );
  assert.deepEqual(
    restrictions(registryOf(kernel), "play-spell", kernel.ref("cataclysm"), kernel.getObject("cataclysm"), "A"),
    []
  );
});

test("Cataclysm golden: the descriptive destination is rejected, never guessed", () => {
  // Guard the red line for the still-missing half: with no runtime Location
  // selector, effect.move's destination() rejects the marker outright, so the
  // unit is never moved to a guessed battlefield.
  const kernel = world().unit("friendly", { owner: "A" }).unit("enemy", { owner: "B", controller: "B" }).build();
  kernel.setTargets("cataclysm.friendly-unit", [kernel.ref("friendly")]);
  const bodyWithoutTargetSpec = [moveInstruction].map(({ targets, ...rest }) => rest);

  assert.throws(
    () => resolveChainBody(bodyWithoutTargetSpec, kernel),
    /effect\.move to must be a location, controller-base, or location choice/
  );
  assert.deepEqual(kernel.getObject("friendly").location, { type: "battlefield", id: "battlefield-1" });
});

test.todo(
  "Cataclysm: the registered prohibition must actually block the opponent's spell plays — " +
    "chain/engine.ts canAct consumes Priority/Showdown/turn state only and does not query " +
    "layers/rules/query.ts restrictions() (CR 355.8 / 806 / 159.2, RIFT-347 follow-up)"
);

test.todo(
  "Cataclysm: moving a friendly unit to an occupied enemy battlefield needs the runtime Location " +
    "selector and the 355.4 / 451.1 destination restrictions — RIFT-90"
);
