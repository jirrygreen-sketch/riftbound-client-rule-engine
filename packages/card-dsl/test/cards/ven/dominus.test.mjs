import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/dominus.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-981bce17b37bbc9e61b2bc56b12191d12b4c0d17be51ad4a950324e1e4941c5a";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "This turn, double a unit's Might and give it \":rb_rune_rainbow::rb_rune_rainbow:: Ready me.\"";

const [actionKeyword, play] = program.abilities;
const [doubleMight, grantReadyAbility] = play.body;
const targetSpec = doubleMight.targets[0];

test("ven-142-166 Dominus: program passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("ven-142-166 Dominus: judgeReason names the ability grant, the Might doubling and [A]", () => {
  assert.match(program.judgeReason, /continuous\.grant-ability/);
  assert.match(program.judgeReason, /433/);
  assert.match(program.judgeReason, /mode 只接受 add\|set/);
  assert.doesNotMatch(program.judgeReason, /RIFT-9\d/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120/);
  assert.doesNotMatch(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /不近似实现/);
});

test("ven-142-166 Dominus: [Action] plus Might doubling and a granted activated ability", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  assert.equal(play.cost, undefined);
  assert.deepEqual(play.body.map((instruction) => [instruction.id, instruction.op]), [
    ["dominus.double-might", "continuous.might"],
    ["dominus.grant-ready-ability", "continuous.grant-ability"]
  ]);

  // 433.1: doubling adds an amount equal to the current Might for this turn; it is an
  // arithmetic-layer modification (475), never a CR 702 Buff counter.
  assert.deepEqual(doubleMight.args, {
    mode: { kind: "constant", value: "multiply" },
    factor: { kind: "constant", value: 2 },
    duration: { kind: "constant", value: "this-turn" }
  });
  // "a unit" is one chosen Board unit (355.7/355.9.a.1/355.10).
  assert.deepEqual(targetSpec, {
    id: "dominus.unit",
    filter: { type: "unit", zone: "board" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.equal(doubleMight.linkedTo, undefined);

  // The granted ability pays two [A] Power (135.2.e.5.a / 163.2.b — the closed six-domain
  // union has no Universal Power value, so the printed symbols stay descriptive) and its
  // body is the merged effect.ready on its own source ("me" = the granted host).
  assert.equal(grantReadyAbility.op, "continuous.grant-ability");
  assert.deepEqual(grantReadyAbility.args.target, { kind: "constant", value: "dominus.unit" });
  assert.deepEqual(grantReadyAbility.args.duration, { kind: "constant", value: "this-turn" });
  assert.equal(grantReadyAbility.args.ability.kind, "constant");
  const granted = grantReadyAbility.args.ability.value;
  assert.equal(granted.kind, "activated");
  assert.equal(granted.timing, "action");
  assert.deepEqual(granted.cost.power, { kind: "constant", value: ["rainbow", "rainbow"] });
  assert.deepEqual(granted.body.map((instruction) => [instruction.id, instruction.op]), [
    ["dominus.granted-ready", "effect.ready"]
  ]);
  // "Ready me": the default selection of effect.ready is the ability source (416.1).
  assert.deepEqual(granted.body[0].args, { objects: { kind: "constant", value: { kind: "source" } } });
  assert.equal(grantReadyAbility.linkedTo, undefined);

  assert.equal(keywordDefinitionsById.has("Action"), true);
  assert.equal(instructionDefinitionsById.get("effect.ready"), ready);
});

test("ven-142-166 Dominus golden: the granted ability's Ready body readies its host (416.1)", () => {
  // The grant/duration wiring is unmerged (judgeReason), but the granted body itself is the
  // real primitive: running it readies the exhausted host exactly as "Ready me" says.
  const kernel = world()
    .unit("renekton", { owner: "A", controller: "A", might: 5, exhausted: true })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("renekton") });

  const outcome = resolveChainBody(grantReadyAbility.args.ability.value.body, scoped);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.events.map((event) => event.action), ["ready"]);
  assert.equal(scoped.getObject("renekton").exhausted, false);
  assert.deepEqual(outcome.linkedValues["dominus.granted-ready.readied"], {
    count: 1,
    objects: [{ id: "renekton", zoneEntryId: 1 }]
  });
});

test("ven-142-166 Dominus: the printed [A][A] cost is descriptive and not payable as a domain", () => {
  // 135.2.e.5.a / 163.2.b: Universal Power is not one of the six frozen domains, so the
  // recorded ["rainbow", "rainbow"] must not be read as any concrete domain.
  const printed = grantReadyAbility.args.ability.value.cost.power.value;
  assert.deepEqual(printed, ["rainbow", "rainbow"]);
  for (const domain of ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]) {
    assert.equal(printed.includes(domain), false);
  }
});

test.todo(
  "ven-142-166 Dominus: double the chosen unit's Might for this turn (433.1/433.1.a, arithmetic layer " +
    "per 475) — continuous.might is registered but only accepts add|set (multiply is rejected and " +
    "factor is not a legal argument key); not approximated as a Buff counter"
);

test.todo(
  "ven-142-166 Dominus: grant the unit the activated ability \"[A][A]: Ready me.\" for this turn " +
    "(399-406, 135.4.b) — needs continuous.grant-ability plus a payable Universal Power cost; the " +
    "six-domain union cannot represent [A] (135.2.e.5.a/163.2.b)"
);
