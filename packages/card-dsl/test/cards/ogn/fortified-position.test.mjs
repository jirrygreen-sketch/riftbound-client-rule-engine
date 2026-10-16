import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/fortified-position.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import shield from "../../../../engine-core/dist/effects/keywords/Shield.js";

const [ability] = program.abilities;
const [instruction] = ability.body;

test("ogn-279-298 Fortified Position: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("ogn-279-298 Fortified Position: identity, ruleset, status and printed text", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-cba0d858c9e26ac8298f585d8f5060e6fe140167286cfa137e3afdd3aa6acdf8"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // deck-catalog.json (ogn-279-298) carries this text verbatim.
  assert.equal(
    program.sourceText,
    "When you defend here, choose a unit. It gains [Shield 2] this combat. (+2 :rb_might: while it's a defender.)"
  );
  assert.match(program.judgeReason, /grant/);
});

test("ogn-279-298 Fortified Position: defend trigger with a once-per-combat identity check", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // CR 383.4.f / 383.4.f.1 / 383.4.f.2.b: a Defend Trigger of the player
  // Defending here (timing point "defense-declared", CR 323.2 / 466.2.c).
  assert.equal(ability.trigger.at, "defense-declared");
  assert.deepEqual(ability.trigger.filter, {
    event: "defense-declared",
    here: true,
    player: "controller"
  });
  // CR 383.4.f.2.a: the defender designation is gained at most once per combat.
  assert.equal(ability.trigger.once, "per-combat");
  assert.equal(ability.optional, false);
});

test("ogn-279-298 Fortified Position: one chosen unit gains Shield 2 for this combat", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(instruction.id, "fortified-position.grant-shield");
  assert.equal(instruction.op, "continuous.grant-keyword");
  assert.equal(instruction.args.keyword.value, "Shield");
  assert.equal(instruction.args.value.value, 2);
  // The combat-bounded lifetime is the engine's "end-of-combat" duration
  // spelling; the printed reminder text is "(+2 [M] while it's a defender)".
  assert.equal(instruction.args.duration.value, "end-of-combat");

  // CR 355.5 / 355.7: "choose a unit" is a choice of a specific Game Object,
  // so it is a target (not a pick) and is revalidated at resolution.
  assert.equal(instruction.targets.length, 1);
  const [target] = instruction.targets;
  assert.equal(target.id, "defended-unit");
  assert.deepEqual(target.filter, { type: "unit", zone: "board" });
  assert.equal(target.min, 1);
  assert.equal(target.max, 1);
  assert.equal(target.selection, "one");
  assert.equal(instruction.picks, undefined);
});

test("ogn-279-298 Fortified Position: the granted keyword expands through the merged Shield definition", () => {
  // Contract 3.7: the keyword file owns the expansion; the card only declares
  // keyword + value. Shield 2 must expand to +2 Might while the unit holds the
  // defender designation (CR 814.1.b/814.1.c/814.1.d.1), which is precisely the
  // effect this card grants for the combat.
  assert.equal(shield.keyword, "Shield");
  assert.equal(shield.valued, true);
  assert.equal(shield.stacking, "sum");
  const expanded = shield.expand({ value: 2, host: { canonicalCardId: program.canonicalCardId } });
  assert.equal(expanded.length, 1);
  const [staticAbility] = expanded;
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.amount.value, 2);
  assert.deepEqual(staticAbility.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "defender" }
  });
});

test.todo(
  "ogn-279-298 Fortified Position: granting a keyword to another object for a bounded duration " +
    "needs the continuous.grant-keyword / continuous.keyword primitive (contract 3.6/3.7), which has " +
    "no merged instruction file"
);

test.todo(
  "ogn-279-298 Fortified Position: the Shield expansion must be consumed by the layers engine " +
    "(continuous.might gated on the defender designation, CR 814.1.c/814.1.d.1)"
);

test.todo(
  "ogn-279-298 Fortified Position: the defense-declared timing point reaching this ability through " +
    "the trigger -> chain pipeline (RIFT-33 scenarios-triggers)"
);
