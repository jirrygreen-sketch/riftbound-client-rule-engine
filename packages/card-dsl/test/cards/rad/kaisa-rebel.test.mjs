import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/kaisa-rebel.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CARD_ID =
  "card.hash-9dec9472d1f77a1c3d9249566ca3fa89140e7b6a4efcb6fe375c4fab210d2e87";

const [disarm, grantReaction] = program.abilities;

test("rad-063-167 Kai'Sa, Rebel: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /831\.1\.d/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-91/);
});

test("rad-063-167 Kai'Sa, Rebel: sourceText is the verbatim deck-catalog ability text", () => {
  assert.equal(
    program.sourceText,
    "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn).\n" +
      "While I'm in a showdown, your spells have [Reaction]. (Play them any time, " +
      "even before spells and abilities resolve.)"
  );
});

test("rad-063-167 Kai'Sa, Rebel: [Disarm] carries the printed default value 1 (831.1.c.3)", () => {
  assert.deepEqual(disarm, { kind: "keyword", keyword: "disarm", value: 1 });
});

test("rad-063-167 Kai'Sa, Rebel: the merged Disarm definition expands the printed attack trigger (831.1.d)", () => {
  const definition = keywordDefinitionsById.get("Disarm");
  assert.ok(definition);
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "sum");
  const [expanded] = definition.expand({ value: 1, host: { canonicalCardId: CARD_ID } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "attack-declared");
  assert.deepEqual(expanded.trigger.filter, { event: "attack-declared", filter: { source: "self" } });
  assert.equal(expanded.body[0].op, "continuous.might");
  assert.deepEqual(expanded.body[0].args.amount, { kind: "constant", value: -1 });
  assert.deepEqual(expanded.body[0].args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(expanded.body[0].targets[0].filter, {
    type: "unit", zone: "board", controller: "opponent", sameLocationAs: "source"
  });
});

test("rad-063-167 Kai'Sa, Rebel: the merged Disarm expansion registers a temporary -1 Might layer", () => {
  const definition = keywordDefinitionsById.get("Disarm");
  const [expanded] = definition.expand({ value: 1, host: { canonicalCardId: CARD_ID } });
  const base = world()
    .unit("kaisa", { controller: "A", owner: "A", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { controller: "B", owner: "B", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const kernel = bindResolveContext(base, {
    source: base.getObject("kaisa"),
    controller: "A",
    query: filter => base.query({
      ...filter,
      ...(filter.controller === "opponent" ? { controller: "B" } : {})
    })
  });
  kernel.setTargets("disarm.enemy-unit", [kernel.ref("enemy")]);
  const outcome = runAbilityBody(expanded.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(createLayerEngine(kernel.objects, kernel.continuousEffects).evaluate(kernel.ref("enemy")).might, 2);
});

test("rad-063-167 Kai'Sa, Rebel: the showdown grant is a conditional static ability, not this card's own [Reaction] (364.3 / 813.4)", () => {
  assert.equal(grantReaction.kind, "static");
  assert.equal(grantReaction.effect.kind, "continuous.grant-keyword");
  // 813.1 / 813.5: the granted keyword targets the controller's spells, not this unit.
  assert.deepEqual(grantReaction.effect.keyword, "reaction");
  assert.deepEqual(grantReaction.effect.filter, { type: "spell", controller: "controller" });
  assert.equal(grantReaction.effect.appliesTo, "controller-spells");
  // "While I'm in a showdown" is the condition (364.3), read from the source object.
  assert.deepEqual(grantReaction.condition, {
    kind: "expression",
    value: { kind: "object-property", object: "self", property: "in-showdown" }
  });
  assert.equal(
    program.abilities.some(ability => ability.kind === "keyword"),
    true,
    "the card declares its own keyword(s)"
  );
  assert.equal(
    program.abilities
      .filter(ability => ability.kind === "keyword")
      .some(ability => ability.keyword === "reaction"),
    false,
    "this unit does not itself have [Reaction]; only its controller's spells are granted it (813.4)"
  );
});

test("rad-063-167 Kai'Sa, Rebel: effect.damage and effect.buff are distinct from Disarm's Might layer", () => {
  // Evidence that the *shape* is understood: effect.buff only places Buff counters (702),
  // it never lowers Might, so Disarm cannot be approximated with it.
  const kernel = world().unit("enemy-unit", { might: 2 }).build();
  const ref = kernel.ref("enemy-unit");
  const run = runInstruction(
    buff,
    // Primitive arg shapes: mode/target are evaluated strings, amount is an Expr.
    { mode: "buff", target: "enemy" },
    { world: kernel, targets: { enemy: [ref] } }
  );
  assert.equal(run.result.status, "executed");
  // A buff is a +1 Might counter; the Disarm penalty is a temporary, negative, duration-bound
  // Might change owned by layers/continuous.might (effect.buff's own documented boundary).
  assert.equal(kernel.getObject("enemy-unit").buffs, 1);
  assert.equal(kernel.getObject("enemy-unit").damage, 0);
});

test("rad-063-167 Kai'Sa, Rebel: effect.damage is unrelated to the negative-Might gap and stays available for the attack trigger", () => {
  // Pins that damage semantics are already merged, so the remaining Disarm gap is exactly the
  // Might modification plus its per-turn duration (831.1.d.1), not target selection.
  const kernel = world().unit("enemy-unit", { might: 2 }).build();
  const ref = kernel.ref("enemy-unit");
  const run = runInstruction(
    damage,
    { amount: { kind: "constant", value: 1 }, target: "enemy" },
    { world: kernel, targets: { enemy: [ref] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy-unit").damage, 1);
});

test.todo(
  "rad-063-167 Kai'Sa, Rebel: [Disarm] attack trigger gives an enemy unit here -1 Might this " +
    "turn, merging several Disarm instances into one trigger with summed values (831.1.d / " +
    "831.1.d.1 / 831.2) — attack event registration and multi-source trigger aggregation remain " +
    "open; the merged KeywordDef and continuous.might execution are covered above"
);

test.todo(
  "rad-063-167 Kai'Sa, Rebel: while this unit is in a showdown, spells its controller plays " +
    "gain [Reaction] (364.3 / 813.4) — needs continuous.grant-keyword and a readable " +
    "showdown/combat state (ObjectSnapshot has no such field; contract 3.8 only added combatRole)"
);

test.todo(
  "rad-063-167 Kai'Sa, Rebel: printing diff — rad-sp4-005 (same canonicalCardId) prints 4 Might " +
    "and omits the reminder text; ability-templates.json records blockers " +
    "[non-reminder-printing-difference, printing-stat-type-or-tag-difference] — card-data task"
);
