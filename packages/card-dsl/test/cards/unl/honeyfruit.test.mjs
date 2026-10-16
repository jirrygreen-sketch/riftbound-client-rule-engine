import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/honeyfruit.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-2cbed9b8e8e6bad981a52533e2be7f623180aac30aad920891bc32d9fedb7d7d";
const SOURCE_TEXT =
  "This enters exhausted.\n" +
  "[Reaction][>] :rb_exhaust:: [Add] :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)\n" +
  "[Level 6][>] [>>][Reaction][>] :rb_exhaust:: [Add] :rb_energy_1::rb_rune_rainbow:. " +
  "(Use this ability only while you have 6+ XP.)";

const [enterExhausted, reactionAdd, levelSixAdd] = program.abilities;
const [universalPower] = reactionAdd.body;
const [energyAndPower] = levelSixAdd.body;

test("unl-049-219 Honeyfruit: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /rainbow/);
  assert.match(program.judgeReason, /824\.1/);
});

test("unl-049-219 Honeyfruit: identity, ruleset, status and the verbatim three-line source text", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(program.sourceText.split("\n").length, 3);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("unl-049-219 Honeyfruit: 'This enters exhausted.' is an entry rewrite, not an exhaust action", () => {
  assert.equal(program.abilities.length, 3);
  assert.equal(enterExhausted.kind, "replacement");
  assert.deepEqual(enterExhausted.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.equal(enterExhausted.with.length, 1);
  const [enter] = enterExhausted.with;
  assert.equal(enter.id, "honeyfruit.enter-exhausted");
  assert.equal(enter.op, "replacement.enter");
  assert.deepEqual(enter.args.state, { kind: "constant", value: "exhausted" });
  assert.deepEqual(enter.args.zone, { kind: "constant", value: "board" });
  // It is an entry-state stipulation, so no effect.exhaust instruction is authored.
  assert.equal(enterExhausted.with.some((step) => step.op === "effect.exhaust"), false);
});

test("unl-049-219 Honeyfruit: the Reaction Add ability is exhaust-cost and adds one universal Power", () => {
  assert.equal(reactionAdd.kind, "activated");
  // 813.1.d: the printed "[Reaction][>]" is this ability's own speed permission.
  assert.equal(reactionAdd.timing, "reaction");
  // 377.1 / 404.1.a: the exhaust before the ":" is the cost (415.3.a / 415.5).
  assert.deepEqual(reactionAdd.cost.payments, [{ kind: "exhaust", object: "self" }]);
  assert.equal(reactionAdd.restriction, undefined);
  assert.deepEqual(reactionAdd.body.map((step) => [step.id, step.op]), [
    ["honeyfruit.add-universal-power", "effect.resources"]
  ]);
  // 430.5 / 135.2.e.5: [A] is Universal Power, which the closed six-domain type cannot
  // express; the program keeps the descriptive rainbow marker rather than guessing a domain.
  assert.deepEqual(universalPower.args, { power: { kind: "constant", value: ["rainbow"] } });
});

test("unl-049-219 Honeyfruit: the [Level 6] clause is a dependent-keyword ability adding 1 Energy + [A]", () => {
  assert.equal(levelSixAdd.kind, "activated");
  assert.equal(levelSixAdd.timing, "reaction");
  // 824.1.b.1 / 824.1.c: the XP dependency is declared on the ability it belongs to.
  assert.deepEqual(levelSixAdd.restriction, {
    kind: "dependent-keyword",
    keyword: "level",
    value: { kind: "constant", value: 6 }
  });
  assert.deepEqual(levelSixAdd.cost.payments, [{ kind: "exhaust", object: "self" }]);
  assert.deepEqual(levelSixAdd.body.map((step) => [step.id, step.op]), [
    ["honeyfruit.add-energy-and-universal-power", "effect.resources"]
  ]);
  // 430.5: "Add [1][A]." is 1 Energy plus 1 Universal Power.
  assert.deepEqual(energyAndPower.args.energy, { kind: "constant", value: 1 });
  assert.deepEqual(energyAndPower.args.power, { kind: "constant", value: ["rainbow"] });
});

test("unl-049-219 Honeyfruit golden: the printed 1 Energy half is granted by the merged primitive", () => {
  // The Energy portion of "Add [1][A]" is fully expressible today: effect.resources grants
  // Energy to the ability controller and reports the actual amount added.
  const kernel = world().unit("honeyfruit", { types: ["gear"], zone: "board" }).build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("honeyfruit") });
  const run = runInstruction(
    resources,
    { energy: { kind: "constant", value: 1 } },
    { world: context }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(context.player("A").energy, 1);
  assert.deepEqual(run.linked.resources, { player: "A", energy: 1, power: [] });
  assert.equal(run.events.some((event) => event.action === "gain-energy"), true);
});

test.todo(
  "unl-049-219 Honeyfruit: \"This enters exhausted.\" needs the board-entry replacement primitive " +
    "(replacement.enter, contract 3.4/3.5) plus the card-IR registration path; effect.exhaust cannot express " +
    "it (CR 143.4/359.2.d assign the entry state, and exhausting after entry adds a spurious becomes-exhausted event)"
);
test.todo(
  "unl-049-219 Honeyfruit: Universal Power [A] (CR 430.5 / 135.2.e.5 / 163.2.b) has no representation in the " +
    "closed six-domain type — a contract change is required before [Add] :rb_rune_rainbow: can execute"
);
test.todo(
  "unl-049-219 Honeyfruit: [Level 6][>] dependent-keyword expansion (CR 824.1.c / 824.1.d) needs an XP predicate " +
    "readable from Condition plus dynamic deactivation; kw-level is not merged"
);
test.todo(
  "unl-049-219 Honeyfruit: the program -> activation/cost plan -> chain registration (contract 3.5) is required " +
    "before either exhaust-cost Add ability can be activated (RIFT-89)"
);
