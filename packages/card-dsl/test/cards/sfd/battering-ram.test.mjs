import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/battering-ram.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const ID = "card.hash-cf0a755fb6b4deccfb2863c8b92871864f69bfbf69522b1c4d98870a89afc0c4";

test("sfd-012-221 Battering Ram: validates identity and dynamic discount shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /cards-played-this-turn/);
  assert.equal(program.sourceText, "I cost :rb_energy_1: less for each card you've played this turn, to a minimum of :rb_energy_1:.");
});

test("sfd-012-221 Battering Ram: declares a negative history-based Energy discount with minimum one", () => {
  const effect = program.abilities[0].effect;
  assert.equal(effect.kind, "continuous.cost-modification");
  assert.equal(effect.resource, "energy");
  assert.deepEqual(effect.amount, {
    kind: "arithmetic",
    operator: "neg",
    operands: [{ kind: "count", subject: "cards-played-this-turn", filter: { player: "controller" } }]
  });
  assert.deepEqual(effect.minimum, { kind: "constant", value: 1 });
  assert.deepEqual(effect.history, { scope: "turn", action: "play", player: "controller" });
});

test.todo("Battering Ram: wire the card static continuous.cost-modification into the play cost plan and supply the per-turn play history count (356.4.e minimum semantics)");
