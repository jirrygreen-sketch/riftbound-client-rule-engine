import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/demon-shade.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-c4b9b8b1ea96f69164e5303d652fe97e69e6f81ce7b8f455b1a108203dd67a45";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Choose a friendly unit, then choose one —\n" +
  "Move it to an open battlefield.Give it [Ganking] this turn if there are no open battlefields. " +
  "(It can move from battlefield to battlefield.)";

const [keyword, play] = program.abilities;
const [mode] = play.body;
const [moveBranch, grantBranch] = mode.args.modes.value;
const [moveInstruction] = moveBranch.body;
const [grantInstruction] = grantBranch.body;

test("Demon Shade program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Demon Shade identity, ruleset, status and printed text (byte-for-byte)", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /170\.11\.c/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-357/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.doesNotMatch(program.judgeReason, /RIFT-(90|91|120|257)/);
  // The catalog text glues "battlefield.Give" together; sourceText keeps it.
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.sourceText.includes("battlefield.Give"), true);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Demon Shade structure: [Hidden], printed cost, and the two exclusive modes", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 3 }
  });
  assert.equal(mode.op, "choice.mode");
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.deepEqual(
    mode.args.modes.value.map((entry) => entry.id),
    ["demon-shade-move", "demon-shade-grant"]
  );
  // "choose one —" (355.3): exactly one mode executes; no linkedTo chain.
  assert.equal(mode.linkedTo, undefined);
  assert.equal(moveBranch.body.length, 1);
  assert.equal(grantBranch.body.length, 1);

  // Move it to an open battlefield (170.11.c): targeted friendly unit and the
  // descriptive destination marker for the missing runtime Location selector.
  assert.equal(moveInstruction.op, "effect.move");
  assert.deepEqual(moveInstruction.args.objects, {
    kind: "constant",
    value: { target: "demon-shade.moved-unit" }
  });
  assert.equal(moveInstruction.args.to.value.kind, "destination-selector");
  assert.equal(moveInstruction.args.to.value.filter.occupied, false);
  assert.deepEqual(moveInstruction.targets, [
    {
      id: "demon-shade.moved-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  // Give it [Ganking] this turn: end-of-turn keyword grant with a friendly target.
  assert.equal(grantInstruction.op, "continuous.grant-keyword");
  assert.deepEqual(grantInstruction.args.keyword, { kind: "constant", value: "Ganking" });
  assert.deepEqual(grantInstruction.args.duration, { kind: "constant", value: "end-of-turn" });
  // The merged primitive's symbolic selector form (contract 3.6).
  assert.deepEqual(grantInstruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "demon-shade.granted-unit" }
  });
  assert.deepEqual(grantInstruction.targets, [
    {
      id: "demon-shade.granted-unit",
      filter: { type: "unit", controller: "controller" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test.todo(
  "Demon Shade: 'an open battlefield' (CR 170.11.c) is a runtime Location choice and needs the runtime " +
    "Location selector plus move restrictions — RIFT-357"
);

test.todo(
  "Demon Shade: 'Give it [Ganking] this turn' needs the end-of-turn continuous.grant-keyword effect (CR 810, " +
    "contract 3.4) — the primitive is merged (RIFT-258); what is missing is the 810.1.c movement-permission" +
    " consumer"
);

test.todo(
  "Demon Shade: 'if there are no open battlefields' needs an empty-collection predicate for the open-battlefield " +
    "set (no compare operator covers set emptiness) — RIFT-359 condition.predicate"
);

test.todo(
  "Demon Shade: the printed 'Choose a friendly unit, then choose one' Finalize order (355.5 before 355.3) belongs " +
    "to the target and mode selection plan — RIFT-358"
);

test("Demon Shade: the [Ganking] grant really registers an ability-layer keyword for the turn", () => {
  // CR 810.1.b: Ganking is the "can move from battlefield to battlefield"
  // permission. The merged continuous.grant-keyword primitive (RIFT-258) is the
  // producer of the ability-layer registration; its end-of-turn duration is the
  // "this turn" lifetime. The movement consumer is tracked in judgeReason.
  const kernel = world()
    .unit("hero", { might: 2 })
    .unit("friendly", { might: 3 })
    .unit("other", { mayMove: true, might: 3 })
    .build();
  kernel.setTargets("demon-shade.granted-unit", [kernel.ref("friendly")]);
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("hero") });

  const outcome = runAbilityBody([{ ...grantInstruction, targets: undefined }], scoped);

  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.continuousEffects.length, 1);
  const registration = scoped.continuousEffects[0];
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(registration.effect.layer, "ability");
  assert.equal(registration.effect.effect.kind, "continuous.grant-keyword");
  assert.equal(registration.effect.effect.keyword, "Ganking");
  assert.equal(registration.effect.filter.objectId, "friendly");

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map(entry => ({
    effect: entry.effect, duration: entry.duration, timestamp: 1
  })));
  assert.deepEqual(engine.evaluate(kernel.ref("friendly")).keywords.map(keyword => keyword.id), ["Ganking"]);
  assert.deepEqual(engine.evaluate(kernel.ref("other")).keywords, []);
  // 317.2.c: the this-turn grant expires at the turn-end timing.
  engine.expireAt("turn-end", "A");
  assert.deepEqual(engine.evaluate(kernel.ref("friendly")).keywords, []);
});
