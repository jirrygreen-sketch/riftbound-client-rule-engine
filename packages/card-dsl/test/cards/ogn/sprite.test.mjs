import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import sprite from "../../../dist/cards/ogn/sprite.js";
import temporary from "../../../../engine-core/dist/effects/keywords/Temporary.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import kill from "../../../../engine-core/dist/effects/instructions/effect.kill.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
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
  assert.match(sprite.judgeReason, /RIFT-257/);
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

test("ogn-274-298 Sprite: the merged Temporary KeywordDef expands to the 816.1.b kill trigger", () => {
  assert.equal(keywordDefinitionsById.get("Temporary"), temporary);
  assert.equal(temporary.keyword, "Temporary");
  assert.equal(temporary.stacking, "single");
  const [expansion] = temporary.expand({ host: { canonicalCardId: sprite.canonicalCardId } });
  assert.equal(expansion.kind, "triggered");
  assert.equal(expansion.optional, false);
  assert.equal(expansion.trigger.at, "beginning-start");
  assert.deepEqual(expansion.body, [{
    id: "temporary:" + CANONICAL + ":kill",
    op: "effect.kill",
    args: { self: { kind: "constant", value: true } }
  }]);
});

test("ogn-274-298 Sprite: the expansion's kill really executes through the chain interpreter", () => {
  const [expansion] = temporary.expand({ host: { canonicalCardId: sprite.canonicalCardId } });
  const base = world()
    .unit("sprite", { might: 3, tags: ["Fae"], isToken: true, zone: "board" })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("sprite") });
  const outcome = resolveChainBody(expansion.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results[0].result.linkedValues.killed, [
    { id: "sprite", zoneEntryId: 1 }
  ]);
  assert.equal(kernel.getObject("sprite").zone, "trash");
});

test.todo(
  "Sprite: the Temporary expansion must be registered as a live trigger when the host exists " +
    "— blocked on the EventPattern event vocabulary admitting beginning-start and on the " +
    "CardProgram keyword/trigger binding (RIFT-257)"
);
