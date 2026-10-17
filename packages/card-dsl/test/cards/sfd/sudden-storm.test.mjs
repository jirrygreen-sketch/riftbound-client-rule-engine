import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sudden-storm.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /facedown/);
  assert.doesNotMatch(program.judgeReason, /combatRole.*未|combatRole.*缺/);
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
