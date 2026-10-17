import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/draven-vanquisher.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const ID = "card.hash-7aaef8697b1c10cad90fa125e7e906fb3e4902535478b033c827f7fcf6f94aa8";

test("sfd-020-221 Draven, Vanquisher: validates identity and three abilities", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Gold/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.equal(program.sourceText, "When I win a combat, play a Gold gear token exhausted.\nWhen I attack or defend, you may pay :rb_rune_fury:. If you do, give me +2 :rb_might: this turn.");
});

test("sfd-020-221 Draven, Vanquisher: combat-win token and attack/defense optional buffs", () => {
  const [win, attack, defense] = program.abilities;
  assert.equal(win.trigger.at, "combat-result");
  assert.deepEqual(win.trigger.filter, { event: "combat-result", filter: { source: "self", result: "win" } });
  assert.deepEqual(win.body[0].args.token, { kind: "constant", value: "gold" });
  assert.equal(win.body[0].args.entersExhausted.value, true);
  for (const ability of [attack, defense]) {
    assert.equal(ability.kind, "triggered");
    assert.equal(ability.optional, false);
    assert.equal(ability.body[0].op, "choice.optional");
    assert.deepEqual(ability.body[0].args.body.value.map((entry) => entry.op), ["cost.pay", "continuous.might"]);
  }
  assert.equal(attack.trigger.at, "attack-declared");
  assert.equal(defense.trigger.at, "defense-declared");
});

test.todo("Draven: add Gold token definition/chain play, combat-result winner binding, cost payment and temporary Might execution (RIFT-62/RIFT-89/RIFT-91)");
