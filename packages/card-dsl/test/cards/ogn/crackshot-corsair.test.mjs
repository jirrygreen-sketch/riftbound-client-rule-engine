import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/crackshot-corsair.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { default: damage } = await import(new URL("effects/instructions/effect.damage.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { TIMING_POINT_IDS } = await import(new URL("events/timing-points.js", engineCore));

const CANONICAL = "card.hash-4acf60426320c2884ae76dd73b385b04731efa6ca356ff3cbaba1c02983837c1";
const [attackTrigger] = program.abilities;
const damageInstruction = attackTrigger.body[0];
const targetSpec = damageInstruction.targets[0];

/** Run the card's own damage instruction with the locked enemy unit. */
const dealTo = (kernel, ids) =>
  runInstruction(damage, { amount: damageInstruction.args.amount, target: targetSpec.id }, {
    world: kernel,
    targets: { [targetSpec.id]: ids.map(id => kernel.ref(id)) }
  });

test("Crackshot Corsair program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /attack-declared/);
  // The gap is the blocked combat role/timing transaction, not a missing
  // combat module.
  assert.match(program.judgeReason, /combat\/flow\.ts/);
  assert.match(program.judgeReason, /TurnCombatBlockedError|combat-start-transaction/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.equal(program.sourceText, "When I attack, deal 1 to an enemy unit here.");
});

test("structure: attack trigger filtered to self with one enemy unit here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(attackTrigger.kind, "triggered");
  assert.equal(attackTrigger.trigger.at, "attack-declared");
  assert.deepEqual(attackTrigger.trigger.filter, {
    event: "attack-declared",
    filter: { source: "self" }
  });
  assert.equal(attackTrigger.trigger.condition, undefined);
  assert.equal(attackTrigger.optional, false);

  assert.equal(attackTrigger.body.length, 1);
  assert.equal(damageInstruction.id, "crackshot.damage");
  assert.equal(damageInstruction.op, "effect.damage");
  assert.equal(damageInstruction.linkedTo, undefined);
  assert.deepEqual(damageInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(damageInstruction.args.target, {
    kind: "constant",
    value: "crackshot.enemy-unit-here"
  });
  // CR 418.6.a: the Deal action's source defaults to the effect describing it.
  assert.equal(damageInstruction.args.source, undefined);
  assert.deepEqual(targetSpec, {
    id: "crackshot.enemy-unit-here",
    filter: { type: "unit", controller: "opponent", sameLocationAs: "source" },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("golden: the printed effect deals exactly 1 to the locked enemy unit", () => {
  const kernel = world()
    .unit("corsair", { zone: "board", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", {
      owner: "B",
      zone: "board",
      location: { type: "battlefield", id: "bf-1" },
      might: 3
    })
    .build();
  const run = dealTo(kernel, ["enemy"]);
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.getObject("enemy").damage, 1);
  assert.equal(run.linked.dealt, 1);
  assert.equal(run.linked.dealtCount, 1);
  assert.deepEqual(run.events.map(event => event.action), ["damage"]);
});

test("golden: a target that left its zone before resolution is ignored, not redirected (CR 359.3.e.7)", () => {
  const kernel = world()
    .unit("corsair")
    .unit("enemy", { owner: "B", might: 3 })
    .unit("bystander", { owner: "B", might: 3 })
    .build();
  const stale = kernel.ref("enemy");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });
  const run = runInstruction(damage, { amount: damageInstruction.args.amount, target: targetSpec.id }, {
    world: kernel,
    targets: { [targetSpec.id]: [stale] }
  });
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("bystander").damage, 0);
  assert.equal(run.events.length, 0);
});

test("dependency evidence: attack-declared is a frozen timing point whose combat-role transaction is blocked", () => {
  assert.ok(TIMING_POINT_IDS.includes("attack-declared"));
});

test.todo(
  "Crackshot Corsair: the attack trigger only becomes reachable when the combat flow emits " +
    "attack-declared (CR 383.4.e / 466.2.c) — combat/flow.ts still throws " +
    "TurnCombatBlockedError at the combat-start-transaction (role designation) and " +
    "simultaneous-damage transaction points"
);
test.todo(
  "Crackshot Corsair: Finalize-time locking of 'an enemy unit here' plus the sameLocationAs anchor " +
    "re-checked at Resolve still needs the production target translator to consume sameLocationAs"
);
