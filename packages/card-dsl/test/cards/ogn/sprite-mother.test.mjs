import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/sprite-mother.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-26cfa8163b875ae8bd95af44a7541e83fd82ea28a881b705af27b209ad3167b0";

test("Sprite Mother program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /effect\.token/);
  assert.match(program.judgeReason, /Sprite/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /RIFT-265/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(
    program.sourceText,
    "When you play me, play a ready 3 :rb_might: Sprite unit token with [Temporary] here. " +
      "(Kill it at the start of its controller's Beginning Phase, before scoring.)"
  );
});

test("Sprite Mother structure: self card-played trigger that plays the printed Sprite token here", () => {
  assert.equal(program.abilities.length, 1);
  const [ability] = program.abilities;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, {
    event: "card-played",
    filter: { role: "self" }
  });

  assert.equal(ability.body.length, 1);
  const [instruction] = ability.body;
  assert.equal(instruction.id, "sprite-mother.play-sprite");
  assert.equal(instruction.op, "effect.token");
  assert.deepEqual(instruction.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 1 });
  // 440.2.c / 185.2.a: a played token is created on the Chain and handed to the
  // play flow; the merged primitive negates this mode as blocked.
  assert.deepEqual(instruction.args.mode, { kind: "constant", value: "play" });
  // 143.4 / 185.2.d entry state: the token enters ready.
  assert.deepEqual(instruction.args.entersReady, { kind: "constant", value: true });
  // "here": the source object's current location, read at resolution.
  assert.deepEqual(instruction.args.location, {
    kind: "object-property",
    object: "source",
    property: "location"
  });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.picks, undefined);
});

test("Sprite Mother golden: the frozen effect.token definition table has no Sprite token, so the play is blocked, not faked", () => {
  const kernel = world().unit("sprite-mother", { might: 3, zone: "board" }).build();
  const [instruction] = program.abilities[0].body;
  const run = runInstruction(
    token,
    {
      token: instruction.args.token,
      amount: instruction.args.amount,
      // The kernel can only reach the definition table through a supported
      // destination; keep the printed mode and location but resolve them the
      // way the primitive will.
      mode: { kind: "constant", value: "create" },
      location: { kind: "constant", value: { type: "base", player: "A" } },
      linkKey: instruction.args.linkKey
    },
    { world: kernel }
  );
  // 187.2's Sprite token is not a frozen definition, so the primitive negates
  // with its documented blocked reason instead of inventing a 3-Might unit.
  assert.equal(run.result.status, "negated");
  assert.equal(run.linked.sprite.blockedReason, "token-definition-or-abilities-judge-required");
  assert.deepEqual(run.linked.sprite.objects, []);
  assert.equal(
    kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken).length,
    0
  );
});

test.todo(
  "Sprite Mother: play a ready 3 [M] Sprite unit token with [Temporary] here (187.2, 440.2.c / 185.2.a / 350.2 / 354): needs the " +
    "Sprite token definition (3 Might, Fae, Temporary), chain creation + play handoff, the ready entry override (143.4 / " +
    "185.2.d) and the Temporary KeywordDef (816) that kills it at the start of its controller's Beginning Phase"
);
