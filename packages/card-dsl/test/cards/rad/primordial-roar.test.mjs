import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/rad/primordial-roar.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-8b6deb587569a3df7032c50ff6c443facba501038a4e6e1fb77f5aedbedb57cf";
const [showOff, play] = program.abilities;
const [showInstruction, dealInstruction] = play.body;
const targetSpec = dealInstruction.targets[0];

test("rad-082-167 Primordial Roar: program passes validateCardProgram with the catalog identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Show Off] a unit. (As you play this, you may reveal a unit from hand or pick a friendly unit.)\n" +
      "If you showed off a unit, deal damage equal to that unit's Might to a unit."
  );
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-082-167 Primordial Roar: judgeReason names the merged keyword and the remaining gaps", () => {
  assert.match(program.judgeReason, /ShowOff\.ts/);
  assert.match(program.judgeReason, /832\.1/);
  assert.match(program.judgeReason, /832\.1\.d\.1/);
  assert.match(program.judgeReason, /cost\.reveal/);
  assert.match(program.judgeReason, /show-off/);
  assert.match(program.judgeReason, /objects-shown-off/);
  assert.match(program.judgeReason, /生产者/);
  assert.equal(program.judgeReason.includes("没有 ShowOff.ts"), false);
});

test("rad-082-167 Primordial Roar: structure — the [Show Off] keyword declaration plus a printed-cost play ability", () => {
  assert.equal(program.abilities.length, 2);
  // CardProgram keyword abilities store the lowercase slug; the registry
  // indexes the printed bracket name (see the Deathknell keyword test).
  assert.deepEqual(showOff, { kind: "keyword", keyword: "show-off", value: 1 });

  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 4 },
    power: { kind: "constant", value: 2 }
  });
});

test("rad-082-167 Primordial Roar: structure — the Show Off choice and its locked-Might contract", () => {
  assert.equal(showInstruction.id, "primordial-roar.show-off");
  assert.equal(showInstruction.op, "effect.show-off");
  assert.deepEqual(showInstruction.args.source.value, {
    from: ["hand", "board"],
    type: "unit",
    controller: "you"
  });
  assert.deepEqual(showInstruction.args.optional, { kind: "constant", value: true });
  // 832.1.d.1: the referenced characteristic is locked when it is shown off.
  assert.deepEqual(showInstruction.args.linkKey, { kind: "constant", value: "shown" });
  assert.deepEqual(showInstruction.args.lockedProperty, { kind: "constant", value: "might" });
  assert.deepEqual(showInstruction.args.lockedKey, { kind: "constant", value: "shownMight" });
  // The shown-off unit is not a target (355.10.a / pick semantics).
  assert.equal(showInstruction.targets, undefined);
  assert.equal(showInstruction.picks, undefined);
});

test("rad-082-167 Primordial Roar: structure — the damage half reads the locked Might and targets one unit", () => {
  assert.equal(play.body.length, 2);
  assert.equal(dealInstruction.id, "primordial-roar.deal-shown-might");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.equal(dealInstruction.linkedTo, showInstruction.id);

  // The amount comes from the Show Off link, never from a re-read of the
  // unit's current Might (832.1.d.1).
  assert.deepEqual(dealInstruction.args.amount, {
    kind: "linked-value",
    instructionId: showInstruction.id,
    key: "shownMight"
  });
  assert.equal(dealInstruction.args.amount.kind, "linked-value");
  assert.notEqual(dealInstruction.args.amount.kind, "object-property");

  // "If you showed off a unit, ..." — the gate is the Show Off link value.
  assert.equal(dealInstruction.condition.kind, "expression");
  assert.deepEqual(dealInstruction.condition.value, {
    kind: "linked-value",
    instructionId: showInstruction.id,
    key: "shown"
  });

  assert.deepEqual(dealInstruction.args.target, { kind: "constant", value: "damaged-unit" });
  assert.equal(dealInstruction.targets.length, 1);
  assert.equal(targetSpec.id, "damaged-unit");
  assert.deepEqual(targetSpec.filter, { type: "unit", zone: "board" });
  assert.equal(targetSpec.min, 1);
  assert.equal(targetSpec.max, 1);
  assert.equal(targetSpec.selection, "one");
  assert.equal(dealInstruction.picks, undefined);
});

test("rad-082-167 Primordial Roar: the damage half executes with the locked Might value", () => {
  // The damage instruction only uses merged primitives; the lock value comes
  // from the Show Off link (which is the unmerged half, see the TODO). With the
  // locked value supplied, the instruction deals exactly that much — proving
  // the authored amount is a locked value and not a re-read.
  const kernel = world()
    .unit("shown-unit", { owner: "A", might: 4 })
    .unit("damaged-unit", { owner: "B", controller: "B", might: 3 })
    .build();
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    {
      world: kernel,
      targets: { [targetSpec.id]: [kernel.ref("damaged-unit")] },
      linked: { shownMight: 4 }
    }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("damaged-unit").damage, 4);
  assert.equal(run.result.linkedValues.dealt, 4);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);

  // The shown unit's own Might is 4, but the locked value is what the damage
  // reads: reducing the shown unit afterwards does not change the dealt amount.
  const stale = kernel.ref("shown-unit");
  kernel.perform({ type: "damage", source: stale, target: stale, amount: 2, combat: false });
  assert.equal(kernel.getObject("shown-unit").might, 4);
  assert.equal(run.result.linkedValues.dealt, 4);
});

test("rad-082-167 Primordial Roar: a missing Show Off link makes the damage instruction ignored, not zero damage", () => {
  // If nothing was shown off, the gate/linked value is unavailable. The
  // interpreter's expression path reports missing linked information as
  // ignored (mistargeted-class) rather than silently dealing 0 damage.
  const kernel = world().unit("damaged-unit", { owner: "B", controller: "B" }).build();
  const run = runInstruction(
    damage,
    { amount: dealInstruction.args.amount, target: targetSpec.id },
    { world: kernel, targets: { [targetSpec.id]: [kernel.ref("damaged-unit")] } }
  );
  assert.equal(run.result.status, "negated");
  assert.notEqual(run.result.status, "executed");
  assert.equal(kernel.getObject("damaged-unit").damage, 0);
});

test.todo(
  "rad-082-167 Primordial Roar: the finalization-time Show Off choice (decline, or reveal a unit from " +
    "hand and/or pick a friendly unit) and the characteristic lock of 832.1.d.1: the merged " +
    "effects/keywords/ShowOff.ts only publishes a cost.reveal declaration with no consumer, " +
    "effect.show-off is not a registered op, and the chain has no objects-shown-off producer."
);

test.todo(
  "rad-082-167 Primordial Roar: hand the printed [Object] clause ('a unit') to the keyword expansion — " +
    "contract 3.8.3's KeywordDef.expand params are not carried by the card-side KeywordAbility."
);
