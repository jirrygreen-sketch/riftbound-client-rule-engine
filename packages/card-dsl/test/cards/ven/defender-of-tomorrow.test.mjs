import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/defender-of-tomorrow.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-a83f38e4a2af89564ecd6ceb9b9d1eb607e58af4d10927e697cd6eb4c95fe037";
const SOURCE_TEXT =
  "[Empower] :rb_energy_2::rb_rune_rainbow::rb_rune_rainbow: " +
  "(:rb_energy_2::rb_rune_rainbow::rb_rune_rainbow:: Empower me. Use only if not Empowered.)\n" +
  ":rb_energy_1:, :rb_exhaust:: Ready a gear.\n" +
  "[Empowered][>] :rb_energy_1:, :rb_exhaust:: Ready 2 gear.";

const [empower, readyOne, readyTwo] = program.abilities;

test("ven-149-166 Defender of Tomorrow: validateCardProgram passes and identity is verbatim", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The Empower keyword expansion and the [A] Universal Power cost have no
  // merged implementation (827.1.c.1 / 828.1.b.1 / 163.2.b), so this card must
  // not claim executability.
  assert.match(program.judgeReason, /empower/i);
  assert.match(program.judgeReason, /163\.2\.b/);
  assert.match(program.judgeReason, /828\.1\.b\.1/);
});

test("ven-149-166: [Empower] is declared as a bare keyword (no card-side expansion)", () => {
  assert.equal(program.abilities.length, 3);
  // 827.1.c.1's "[Cost]: Empower me. Use only if not Empowered." is the
  // keyword's expansion; the card declares the keyword only, exactly like the
  // other keyword-only programs (contract 3.7). The printed cost (2 Energy +
  // 2 [A]) is recorded in the header and judgeReason because KeywordAbility
  // has no params field to carry it (contract change request).
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });
});

test("ven-149-166: 'Ready a gear' is one 1-Energy + Exhaust action ability targeting a gear", () => {
  assert.equal(readyOne.kind, "activated");
  assert.equal(readyOne.timing, "action");
  assert.deepEqual(readyOne.cost.energy, { kind: "constant", value: 1 });
  assert.deepEqual(readyOne.cost.payments, [{ kind: "exhaust", object: "self" }]);
  assert.equal(readyOne.body.length, 1);
  const [instruction] = readyOne.body;
  assert.equal(instruction.id, "defender-of-tomorrow.ready-gear");
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args.objects, {
    kind: "constant",
    value: { kind: "target", id: "defender-of-tomorrow.gear" }
  });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(instruction.targets, [
    {
      id: "defender-of-tomorrow.gear",
      filter: { type: "gear", zone: "board" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
});

test("ven-149-166: the [Empowered] clause is a second ability gated by the dependent keyword", () => {
  assert.equal(readyTwo.kind, "activated");
  assert.equal(readyTwo.timing, "action");
  // 828.1.b.1: "While I have the Empowered status, this card gains [Text]."
  assert.deepEqual(readyTwo.restriction, { kind: "dependent-keyword", keyword: "empowered" });
  const [instruction] = readyTwo.body;
  assert.equal(instruction.id, "defender-of-tomorrow.ready-2-gear");
  assert.equal(instruction.op, "effect.ready");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  // "Ready 2 gear": exactly two gear, not "up to" (355.13 would allow zero).
  assert.equal(instruction.targets[0].id, "defender-of-tomorrow.gears");
  assert.equal(instruction.targets[0].selection, "any");
  assert.equal(instruction.targets[0].min, 2);
  assert.equal(instruction.targets[0].max, 2);
});

test("ven-149-166 golden: 'Ready a gear' readies an exhausted gear through the interpreter", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], zone: "board" })
    .unit("gear-1", { types: ["gear"], exhausted: true })
    .build();
  kernel.setTargets("defender-of-tomorrow.gear", [kernel.ref("gear-1")]);

  const outcome = runAbilityBody(readyOne.body, kernel, undefined, {
    host: kernel.ref("legend")
  });
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(result => result.id), [
    "defender-of-tomorrow.ready-gear"
  ]);
  assert.equal(kernel.getObject("gear-1").exhausted, false);
  assert.deepEqual(kernel.events.map(event => event.action), ["ready"]);
});

test("ven-149-166 golden: the [Empowered] clause readies exactly two exhausted gear", () => {
  const kernel = world()
    .unit("legend", { types: ["legend"], zone: "board" })
    .unit("gear-1", { types: ["gear"], exhausted: true })
    .unit("gear-2", { types: ["gear"], exhausted: true })
    .unit("gear-3", { types: ["gear"], exhausted: true })
    .build();
  kernel.setTargets("defender-of-tomorrow.gears", [
    kernel.ref("gear-1"),
    kernel.ref("gear-2"),
    kernel.ref("gear-3")
  ]);

  const outcome = runAbilityBody(readyTwo.body, kernel, undefined, {
    host: kernel.ref("legend")
  });
  assert.equal(outcome.status, "executed");
  const readied = outcome.results[0].result.linkedValues.readied;
  assert.equal(readied.count, 2);
  assert.equal(kernel.getObject("gear-1").exhausted, false);
  assert.equal(kernel.getObject("gear-2").exhausted, false);
  assert.equal(kernel.getObject("gear-3").exhausted, true);
});

test.todo(
  "ven-149-166: Empower/Empowered keyword expansion (827.1.c.1 activation cost + 'only if not " +
    "Empowered' restriction, 828.1.b.1 dependent ability activation) — no Empower/Empowered " +
    "KeywordDef exists in effects/keywords/registry.generated.ts (RIFT-81~88 batch excludes them); " +
    "also needs RIFT-89 cost wiring and RIFT-91 layer consumption"
);

test.todo(
  "ven-149-166: pay the Empower cost 2 Energy + 2 [A] (135.2.e.5.a / 163.2.b) — the closed six-domain " +
    "Domain union has no Universal Power value (contract change request, RIFT-89)"
);
