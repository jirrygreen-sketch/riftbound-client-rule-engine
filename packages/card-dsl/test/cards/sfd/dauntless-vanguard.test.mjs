import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/dauntless-vanguard.js";

test("sfd-093-221 Dauntless Vanguard: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(
    program.canonicalCardId,
    "card.hash-cf0b322a78010676e3d8b287830194a3bdc8970e65a141578ae8a3074ebd956f"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, "You may play me to an occupied enemy battlefield.");
});

test("sfd-093-221 Dauntless Vanguard: single static play-location permission", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "play-location-permission");
  const value = ability.effect.value;
  assert.equal(value.kind, "constant");
  assert.deepEqual(value.value, {
    zone: "battlefield",
    battlefield: { occupied: true, controller: "opponent" },
    appliesTo: "self"
  });
  assert.equal(ability.effect.duration, "while-in-hand");
  assert.equal(ability.condition, undefined);
});

test.todo(
  "sfd-093-221 Dauntless Vanguard: occupied-enemy-battlefield play destination is accepted " +
    "by Finalize once the layers/continuous-effect consumer for play-location-permission " +
    "lands (RIFT-32 scenarios-layers / RIFT-27 scenarios-costs 打出位置校验)"
);
