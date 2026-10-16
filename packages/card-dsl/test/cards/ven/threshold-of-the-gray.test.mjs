import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/threshold-of-the-gray.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-f3d497c8272c7189495fd4ff73a5a4450b60af7a9e559bdf73d4c3e1380bfcc3";
const SOURCE_TEXT = "When combat starts here, the attacker and defender each [Add] :rb_energy_1:.";

const [ability] = program.abilities;
const [attacker, defender] = ability.body;

/** The two body instructions with the missing event-participant seats filled in. */
function bodyFor(attackerId, defenderId) {
  return [
    { ...attacker, args: { ...attacker.args, player: { kind: "constant", value: attackerId } } },
    { ...defender, args: { ...defender.args, player: { kind: "constant", value: defenderId } } }
  ];
}

test("ven-166-166 Threshold of the Gray: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-166-166 Threshold of the Gray: identity, ruleset, status and exact source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The gap is the event-participant binding (and the combat-start emission).
  assert.match(program.judgeReason, /event-combat-attacker/);
  assert.match(program.judgeReason, /466\.2\.c\.1/);
  assert.match(program.judgeReason, /RIFT-120/);
});

test("ven-166-166 Threshold of the Gray: combat-start-here trigger for both combat participants", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.1 ("When …" begins a Triggered Ability) + 466.1/466.2.b (the start of
  // combat effects, which the closed timing point combat-start owns).
  assert.equal(ability.trigger.at, "combat-start");
  // 053.3 "here". The ability's recipient is the attacker/defender pair, not
  // necessarily the battlefield's controller, so no player selector is claimed.
  assert.deepEqual(ability.trigger.filter, { event: "combat-start", here: true });
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.optional, false);

  // 430.5 "Add [one or more resources].": one Energy for the attacker and one
  // for the defender, as two separate instructions.
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "threshold-of-the-gray.add-attacker",
    "threshold-of-the-gray.add-defender"
  ]);
  for (const instruction of [attacker, defender]) {
    assert.equal(instruction.op, "effect.resources");
    assert.deepEqual(instruction.args.energy, { kind: "constant", value: 1 });
    // 430.1/430.5: Energy only — the card never Adds Power.
    assert.equal(instruction.args.power, undefined);
    assert.equal(instruction.targets, undefined);
    assert.equal(instruction.picks, undefined);
    assert.equal(instruction.linkedTo, undefined);
  }
  assert.deepEqual(attacker.args.player, { kind: "constant", value: "event-combat-attacker" });
  assert.deepEqual(defender.args.player, { kind: "constant", value: "event-combat-defender" });
});

test("ven-166-166 Threshold of the Gray: the placeholders are not players, so nothing is silently Added", () => {
  const kernel = world().build();

  const outcome = resolveChainBody(ability.body, kernel);

  // The as-printed seats do not resolve to any player; the merged
  // effect.resources refuses the instruction instead of adding Energy to the
  // battlefield's controller by proxy (430.4.a: never Add without direction).
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["threshold-of-the-gray.add-attacker", "negated"],
    ["threshold-of-the-gray.add-defender", "negated"]
  ]);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.player("B").energy, 0);
  assert.deepEqual(kernel.events, []);
});

test("ven-166-166 Threshold of the Gray golden: with both seats bound, each participant Adds exactly 1 Energy", () => {
  const kernel = world().build();

  const outcome = resolveChainBody(bodyFor("B", "A"), kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status]), [
    ["threshold-of-the-gray.add-attacker", "executed"],
    ["threshold-of-the-gray.add-defender", "executed"]
  ]);
  // 430.1/430.5: one Energy each, into that player's Rune Pool; no Power, and
  // the allocation follows the combat designations (B attacked, A defended).
  assert.equal(kernel.player("B").energy, 1);
  assert.equal(kernel.player("A").energy, 1);
  assert.deepEqual(kernel.player("A").power, []);
  assert.deepEqual(kernel.player("B").power, []);
  assert.deepEqual(kernel.events.map(event => event.action), ["gain-energy", "gain-energy"]);
  assert.deepEqual(outcome.results[0].result.linkedValues.resources, {
    player: "B",
    energy: 1,
    power: []
  });
  assert.deepEqual(outcome.results[1].result.linkedValues.resources, {
    player: "A",
    energy: 1,
    power: []
  });
});

test("ven-166-166 Threshold of the Gray golden: a replaced Energy gain is negated and reports the actual 0", () => {
  const kernel = world().build();
  kernel.addReplacement(action => action.type === "gain-energy" ? "prevented" : null);

  const outcome = resolveChainBody(bodyFor("B", "A"), kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => result.result.status), ["negated", "negated"]);
  assert.deepEqual(outcome.results.map(result => result.result.reason), ["skipped", "skipped"]);
  assert.equal(kernel.player("A").energy, 0);
  assert.equal(kernel.player("B").energy, 0);
  assert.deepEqual(kernel.events.map(event => event.action), ["gain-energy", "gain-energy"]);
  // The primitive reports the actual addition (0) through its link instead of
  // pretending the printed 1 landed.
  assert.deepEqual(kernel.linkedSnapshot()["threshold-of-the-gray.add-attacker.resources"], {
    player: "B",
    energy: 0,
    power: []
  });
  assert.deepEqual(kernel.linkedSnapshot()["threshold-of-the-gray.add-defender.resources"], {
    player: "A",
    energy: 0,
    power: []
  });
});

test.todo(
  "ven-166-166 Threshold of the Gray: bind 'the attacker and defender' to the combat-start participants — the " +
    "frozen IR has no event-participant selector (events/trigger-spec.ts PlayerSelector is self/opponent/any/{playerId}; " +
    "contract 3.8 combatRole is not in engine-core effects/contract.ts), so the two seats stay placeholders"
);

test.todo(
  "ven-166-166 Threshold of the Gray: the combat-start-here trigger runs end to end — needs combat → chain/events " +
    "combat-start emission plus CardProgram TriggerRegistration (RIFT-120 / §7.2 batch 5, RIFT-33) and the 053.3 \"here\" anchor"
);
