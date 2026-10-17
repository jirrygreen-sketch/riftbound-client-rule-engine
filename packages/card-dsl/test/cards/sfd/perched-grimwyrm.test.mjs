import assert from "node:assert/strict";
import test from "node:test";
import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/perched-grimwyrm.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";

const ID = "card.hash-1e5601a20e9eec5eb8bd27251a8711e541767f111db13703166777e918b52cbb";

test("sfd-015-221 Perched Grimwyrm: validates identity and play restriction", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardProgramsById.get(ID), program);
  assert.equal(program.canonicalCardId, ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.17\.b/);
  assert.match(program.judgeReason, /conquered this turn/);
  assert.equal(program.sourceText, "Play me only to a battlefield you conquered this turn. (You can't play me anywhere else.)");
});

test("sfd-015-221 Perched Grimwyrm: restriction is separate from the empty play body", () => {
  const ability = program.abilities[0];
  assert.equal(ability.kind, "play");
  assert.deepEqual(ability.restriction, {
    kind: "play-only-to-conquered-battlefield-this-turn",
    value: { kind: "constant", value: { location: "battlefield", controller: "controller", conqueredThisTurn: true } }
  });
  assert.deepEqual(ability.body, []);
});

// Remaining gap: the generic play restriction reaches Finalize, but this
// dedicated restriction kind still needs an adapter, and no rule records
// conquered battlefields per turn and battlefield (361/366).
