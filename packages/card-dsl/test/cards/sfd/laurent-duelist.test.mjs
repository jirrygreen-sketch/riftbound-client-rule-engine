import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/laurent-duelist.js";
import { expandProgram } from "../../../../engine-core/dist/programs/keywords.js";

const CARD_ID = "card.hash-7cbc2a92adfe5cf5c7126a8d72869cf933d006002fe1f46b4804c2040a51c9c6";

const snapshot = () => ({
  ref: { id: "duelist", zoneEntryId: 1 },
  cardId: CARD_ID,
  name: "Laurent Duelist",
  types: ["unit"],
  tags: [],
  // The declared keyword is the card data under test; the snapshot carries no
  // duplicate printed copy (expandProgram combines declared + printed entries).
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: null,
  might: 4,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
});

test("program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("identity: canonicalCardId, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /[Aa]ssault/);
  assert.match(program.judgeReason, /designation/);
  assert.match(program.judgeReason, /combat-start-transaction/);
  assert.equal(program.sourceText, "[Assault 2] (+2 :rb_might: while I'm an attacker.)");
});

test("abilities: exactly one Assault keyword ability with value 2", () => {
  assert.equal(program.abilities.length, 1);
  const ability = program.abilities[0];
  assert.equal(ability.kind, "keyword");
  assert.equal(ability.keyword, "assault");
  assert.equal(ability.value, 2);
});

test("the merged Assault expansion resolves the keyword into a +2 Might static ability (807.1.c)", () => {
  const expanded = expandProgram(program, snapshot());
  assert.equal(expanded.expanded.length, 1);
  const [staticAbility] = expanded.expanded;
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.might");
  assert.equal(staticAbility.effect.mode, "add");
  assert.deepEqual(staticAbility.effect.amount, { kind: "constant", value: 2 });
  // 807.1.d.1: the bonus lasts exactly while the unit holds the Attacker designation.
  assert.deepEqual(staticAbility.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "designation" },
    operator: "eq",
    right: { kind: "constant", value: "attacker" }
  });
});

test.todo(
  "sfd-156-221 Laurent Duelist: +2 Might exactly while the unit holds the Attacker designation (807.1.d.1) — " +
    "combat/flow.ts still throws combat-start-transaction, so nothing writes the designation the expansion's " +
    "condition reads and the merged layer conditions do not evaluate that predicate"
);
