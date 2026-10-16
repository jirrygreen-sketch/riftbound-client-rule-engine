import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import sprite from "../../../dist/cards/ogn/sprite.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-610cc33146e5be610b1b548bd327d47a44aba21edb081e7669cba4971753ccef";

test("ogn-274-298 Sprite: program passes validateCardProgram", () => {
  const result = validateCardProgram(sprite);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-274-298 Sprite: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(sprite.canonicalCardId, CANONICAL);
  assert.equal(sprite.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(sprite.status, "judge-required");
  assert.match(sprite.judgeReason, /Temporary/);
  assert.match(sprite.judgeReason, /816\.1\.b/);
  assert.match(sprite.judgeReason, /beginning-start/);
  assert.match(sprite.judgeReason, /keywords\/Temporary\.ts/);
  assert.equal(
    sprite.sourceText,
    "[Temporary] (Kill me at the start of your Beginning Phase, before scoring.)"
  );
});

test("ogn-274-298 Sprite: the only ability is the Temporary keyword declaration", () => {
  assert.equal(sprite.abilities.length, 1);
  // CR 816 carries no numeric parameter, so `value` is omitted (README section 5).
  assert.deepEqual(sprite.abilities, [{ kind: "keyword", keyword: "temporary" }]);
});

test("ogn-274-298 Sprite: the merged kill primitive already performs CR 816.1.b 'kill this'", () => {
  // The Temporary expansion will be "at the controller's Beginning Phase start,
  // kill this" (816.1.b/816.1.c). The kill half already runs through the real
  // primitive and reference kernel; only the phase trigger + keyword expansion
  // are missing.
  const kernel = world().unit("sprite", { owner: "A", might: 3, tags: ["Fae"], isToken: true }).build();
  const spriteRef = kernel.ref("sprite");
  // Bind the resolving source to the Sprite itself (its controller's host).
  const source = kernel.clone({ sourceSnapshot: kernel.getObject("sprite") });

  const run = runInstruction(kill, { self: true }, { world: source });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.linked.killed, [spriteRef]);
  assert.equal(source.getObject("sprite").zone, "trash");
});

test.todo(
  "Sprite: the Temporary keyword expansion exists (keywords/Temporary.ts) and registers an " +
    "beginning-start subscription that kills the host at its controller's Beginning Phase start, " +
    "before scoring (CR 816.1.b/816.1.c) — no Temporary KeywordDef is registered today"
);

test.todo(
  "Sprite: CR 816.2 — multiple Temporary instances stay redundant and still kill only once " +
    "(stacking 需由 keywords/Temporary.ts 声明为 single)"
);
