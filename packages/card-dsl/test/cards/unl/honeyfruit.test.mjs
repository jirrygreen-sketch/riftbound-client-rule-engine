import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/honeyfruit.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import resources from "../../../../engine-core/dist/effects/instructions/effect.resources.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-2cbed9b8e8e6bad981a52533e2be7f623180aac30aad920891bc32d9fedb7d7d";
const SOURCE_TEXT =
  "This enters exhausted.\n" +
  "[Reaction][>] :rb_exhaust:: [Add] :rb_rune_rainbow:. (Abilities that add resources can't be reacted to.)\n" +
  "[Level 6][>] [>>][Reaction][>] :rb_exhaust:: [Add] :rb_energy_1::rb_rune_rainbow:. (Use this ability only while you have 6+ XP.)";

const [enterExhausted, reactionAdd, levelSixAdd] = program.abilities;
const [universalPower] = reactionAdd.body;
const [energyAndPower] = levelSixAdd.body;

test("unl-049-219 Honeyfruit: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.status, "judge-required");
  // Replacement registration and activation description are merged; the
  // remaining gaps are Universal Power and the [Level N] predicate.
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /rainbow/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /RIFT-359/);
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
  // An entry-state stipulation, so no effect.exhaust instruction is authored.
  assert.equal(enterExhausted.with.some((step) => step.op === "effect.exhaust"), false);
});

test("unl-049-219 Honeyfruit golden: the merged replacement pipeline rewrites the board entry", () => {
  // replacement.enter is bound through replacement/bind.ts; the entry
  // rewrite happens before the move commits, so no separate becomes-exhausted
  // timing is produced on the Board (CR 143.4 / 359.2.d).
  const kernel = world()
    .unit("honeyfruit", { types: ["gear"], energy: 2, power: null, zone: "hand", location: null })
    .build();
  const hostRef = kernel.ref("honeyfruit");
  const registrations = [];
  bindReplacement(
    enterExhausted,
    hostRef,
    {
      host: { object: (ref) => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
      pipeline: { clock: { turn: 1 }, registerReplacement: (registration) => registrations.push(registration) }
    }
  );

  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  const entering = {
    type: "move-zone",
    object: kernel.ref("honeyfruit"),
    to: "base",
    location: { type: "base", player: "A" }
  };
  const [registration] = registrations;
  assert.equal(registration.matches(entering, entering), true);
  const replacement = registration.apply(entering, entering);
  assert.equal(replacement.status, "replace");
  assert.deepEqual(replacement.actions.map((action) => action.type), ["exhaust", "move-zone"]);
  for (const action of replacement.actions) assert.equal(kernel.perform(action).status, "done");

  const entered = kernel.getObject("honeyfruit");
  assert.equal(entered.zone, "board");
  assert.deepEqual(entered.location, { type: "base", player: "A" });
  assert.equal(entered.exhausted, true);
  // One move-zone (hand -> chain), the replacement exhaust, then the board entry.
  assert.deepEqual(kernel.events.map((event) => event.action), ["move-zone", "exhaust", "move-zone"]);
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
  // 430.5 / 135.2.e.5: [A] is Universal Power, which the closed six-domain type
  // cannot express; the program keeps the descriptive rainbow marker.
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

test("unl-049-219 Honeyfruit: the merged activation adapter describes the Reaction Add ability", () => {
  // describeActivate produces the ChainDraft for the Reaction Add
  // ability, including its exhaust cost and the declared body.
  const { judgeReason, ...rest } = program;
  const binding = createProgramBinding({ cardPrograms: [{ ...rest, status: "executable" }] });
  const source = {
    ref: { id: "honeyfruit", zoneEntryId: 1 }, cardId: CARD_ID, name: "Honeyfruit", types: ["gear"],
    tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: { type: "base", player: "A" }, might: null, energy: 2, power: null, exhausted: false,
    damage: 0, stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false, combatRole: null
  };
  assert.equal(binding.activationAbilities(source).length, 2);
  const draft = binding.describeActivate(source, "A", 0);
  assert.equal(draft.speed, "reaction");
  assert.equal(draft.kind, "activated");
});

test("unl-049-219 Honeyfruit golden: the printed 1 Energy half is granted by the merged primitive", () => {
  // The Energy portion of "Add [1][A]" is fully expressible today.
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
  "unl-049-219 Honeyfruit: Universal Power [A] (CR 430.5 / 135.2.e.5 / 163.2.b) has no representation in the " +
    "closed six-domain type — a contract change is required before [Add] :rb_rune_rainbow: can execute"
);
test.todo(
  "unl-049-219 Honeyfruit: [Level 6][>] dependent-keyword expansion (CR 824.1.c / 824.1.d) needs an XP predicate " +
    "readable from Condition plus dynamic deactivation — the merged Level KeywordDef emits condition.predicate + " +
    "controller-xp, but layers/engine.ts does not consume it and PlayerSnapshot.xp is not Expr-readable"
);
