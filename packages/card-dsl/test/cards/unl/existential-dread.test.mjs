import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/existential-dread.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-2ac2d6f3f32c301570d1dfe70ea13dd6550a4c9e791dee4da9ddfc79cc63a87c";
const SOURCE_TEXT =
  "[Action] (Play on your turn or in showdowns.)\n" +
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "[Stun] an attacking enemy unit. If it's already stunned, return it to its owner's hand instead. " +
  "(A stunned unit doesn't deal combat damage this turn.)";

const TARGET_ID = "existential-dread.attacking-enemy-unit";
const STUN_ID = "existential-dread.stun-attacker";
const RETURN_ID = "existential-dread.return-if-stunned";

const [actionKeyword, play] = program.abilities;
const [stunInstruction, returnInstruction] = play.body;

// effect.stun's merged schema requires a literal TargetSpec id and the chain
// adapter does not yet register that literal field (ogn/solari-chief records
// the same gap), so the Stun branch is executed through the interpreter while
// the effect.zone branch goes through the chain adapter. Both run the card's
// own instruction. TargetSpecs are provisioned with setTargets.
const stunForExecution = (({ targets, ...rest }) => rest)(stunInstruction);
const returnForExecution = (({ targets, ...rest }) => rest)(returnInstruction);

test("unl-134-219 Existential Dread: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-134-219 Existential Dread: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /programs\/filters\.ts/);
  assert.match(program.judgeReason, /programs\/play\.ts/);
  assert.doesNotMatch(program.judgeReason, /RIFT-86|RIFT-89|RIFT-91|RIFT-120|RIFT-257/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-134-219 Existential Dread: [Action], printed cost, Repeat payment and two mutually exclusive branches", () => {
  assert.deepEqual(actionKeyword, { kind: "keyword", keyword: "action" });
  assert.equal(actionKeyword.value, undefined);

  assert.equal(play.kind, "play");
  // Catalog: 1 energy + 1 Chaos power printed base cost, plus the printed
  // [Repeat] :rb_energy_2: optional additional cost (820.1 / 820.1.c).
  assert.equal(play.cost.kind, "cost.printed");
  assert.deepEqual(play.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(play.cost.power, { kind: "constant", value: 1 });
  assert.equal(play.cost.payments.length, 1);
  const [repeatPayment] = play.cost.payments;
  assert.equal(repeatPayment.kind, "energy");
  assert.equal(repeatPayment.keyword, "repeat");
  assert.deepEqual(repeatPayment.amount, { kind: "constant", value: 2 });
  assert.deepEqual(repeatPayment.choice, {
    id: "existential-dread.repeat-payment",
    options: ["pay", "decline"],
    selection: "one"
  });

  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      [STUN_ID, "effect.stun"],
      [RETURN_ID, "effect.zone"]
    ]
  );
  assert.equal(play.body.length, 2);
});

test("unl-134-219 Existential Dread: the attacking-enemy target and the stunned/not-stunned branches", () => {
  // One shared selection: "an attacking enemy unit" is chosen once (355.5 / 355.8).
  // combatRole is the contract 3.8 item-1 field name; no merged filter key or
  // characteristic evaluates it yet (see judgeReason).
  for (const instruction of [stunInstruction, returnInstruction]) {
    assert.deepEqual(instruction.targets, [
      {
        id: TARGET_ID,
        filter: {
          type: "unit",
          controller: "opponent",
          zone: "board",
          combatRole: "attacker"
        },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]);
  }

  // "[Stun] an attacking enemy unit. If it's already stunned, return it to its
  // owner's hand instead.": both branches read the chosen unit's current
  // stunned state (424.1.a) and are mutually exclusive.
  assert.deepEqual(stunInstruction.condition, {
    kind: "compare",
    left: { kind: "object-property", object: { target: TARGET_ID }, property: "stunned" },
    operator: "eq",
    right: { kind: "constant", value: false }
  });
  assert.deepEqual(stunInstruction.args, {
    target: { kind: "constant", value: TARGET_ID }
  });

  assert.deepEqual(returnInstruction.condition, {
    kind: "compare",
    left: { kind: "object-property", object: { target: TARGET_ID }, property: "stunned" },
    operator: "eq",
    right: { kind: "constant", value: true }
  });
  assert.deepEqual(returnInstruction.args, {
    target: { kind: "constant", value: TARGET_ID },
    // "to its owner's hand": return-to-hand routes to the card's owner (056.1).
    to: { kind: "constant", value: "hand" }
  });

  // Neither branch references the other's result, so neither is linked
  // (359.3.e.14); their shared target is what makes them exclusive.
  assert.equal(stunInstruction.linkedTo, undefined);
  assert.equal(returnInstruction.linkedTo, undefined);
});

test("unl-134-219 Existential Dread golden: a not-yet-stunned enemy unit is stunned (424.1)", () => {
  const kernel = world().unit("enemy", { owner: "B", controller: "B", stunned: false }).build();
  kernel.setTargets(TARGET_ID, [kernel.ref("enemy")]);

  const outcome = runAbilityBody([stunForExecution], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [[STUN_ID, "executed"]]
  );
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.equal(kernel.getObject("enemy").zone, "board");
  // 424.1.a.1: it stays a single Stunned state, not a counter or damage mark.
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(outcome.events.map((event) => event.action), ["stun"]);
  assert.equal(outcome.results[0].result.linkedValues.stunned.count, 1);
});

test("unl-134-219 Existential Dread golden: an already-stunned enemy unit returns to its owner's hand instead", () => {
  const kernel = world().unit("enemy", { owner: "B", controller: "B", stunned: true }).build();
  kernel.setTargets(TARGET_ID, [kernel.ref("enemy")]);

  const outcome = resolveChainBody([returnForExecution], kernel);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [[RETURN_ID, "executed"]]
  );
  // 056.1: the return routes to the owner's hand, not the caster's.
  assert.equal(kernel.getObject("enemy").zone, "hand");
  assert.deepEqual(kernel.zone("B", "hand").map((ref) => ref.id), ["enemy"]);
  assert.deepEqual(kernel.zone("A", "hand"), []);
  assert.deepEqual(outcome.events.map((event) => event.action), ["return-to-hand"]);
});

test("unl-134-219 Existential Dread golden: the not-stunned branch is skipped when the unit is already stunned", () => {
  const kernel = world().unit("enemy", { owner: "B", controller: "B", stunned: true }).build();
  kernel.setTargets(TARGET_ID, [kernel.ref("enemy")]);

  const outcome = runAbilityBody([stunForExecution], kernel);

  // The per-instruction condition (contract 3.4) makes the branch a legal skip,
  // not a rules violation; 424.1.a.1 keeps the unit Stunned and untouched.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.getObject("enemy").stunned, true);
  assert.equal(kernel.getObject("enemy").zone, "board");
  assert.deepEqual(kernel.events, []);
});

test("unl-134-219 Existential Dread golden: a stale target ignores the Stun branch (359.3.e.7)", () => {
  const kernel = world().unit("enemy", { owner: "B", controller: "B" }).build();
  const stale = kernel.ref("enemy");
  assert.equal(kernel.perform({ type: "kill", object: stale }).status, "done");
  kernel.setTargets(TARGET_ID, [stale]);

  // Only the setup kill is in the kernel's log so far.
  const eventsBefore = kernel.events.length;

  const outcome = runAbilityBody([stunForExecution], kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(outcome.events, []);
  assert.equal(kernel.events.length, eventsBefore);
});

test.todo(
  "Existential Dread: the \"attacking\" restriction needs the Attacker designation as a readable characteristic " +
    "(contract 3.8 item 1's ObjectSnapshot.combatRole, CR 459/807) plus a filter value for it; programs/filters.ts " +
    "does not yet accept combatRole, so the card stays judge-required"
);

test.todo(
  "Existential Dread: the printed [Repeat] :rb_energy_2: additional cost needs its payment and paid-instance count " +
    "wired to resolution so the effect is executed one additional time (CR 820.1 / 820.1.d); " +
    "programs/play.ts currently rejects additional-cost"
);

test.todo(
  "Existential Dread: the engine-side chain adapter must register effect.stun's literal target field before the card's " +
    "Stun branch can run through resolveChainBody (chain/interpreter-adapter.ts LITERAL_FIELDS; the same gap " +
    "ogn/solari-chief records)"
);
