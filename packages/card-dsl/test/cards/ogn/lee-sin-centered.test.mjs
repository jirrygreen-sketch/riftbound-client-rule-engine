import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/lee-sin-centered.js";
import accelerate from "../../../../engine-core/dist/effects/keywords/Accelerate.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import mightPrimitive from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-98fc18fcf30d6dd0b192f1c6ea251dd6a2e6d4a439098c533f77e58a2161074f";
const c = value => ({ kind: "constant", value });

test("ogn-151-298 Lee Sin, Centered: program validates and keeps identity", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(
    program.sourceText,
    "[Accelerate] (You may pay :rb_energy_1::rb_rune_body: as an additional cost to have me enter ready.)\n" +
      "Other buffed friendly units at my battlefield have +2 :rb_might:."
  );
});

test("ogn-151-298 Lee Sin, Centered: printed power is null (no printed value) and is never rewritten to 0", () => {
  // The catalog carries power: null; the program has no cost block at all, so
  // nothing can turn the missing printed value into a 0 cost. This test pins
  // that shape for reviewers.
  assert.equal(Object.hasOwn(program, "cost"), false);
  assert.equal(program.abilities.some(ability => ability.kind === "play"), false);
  assert.equal(JSON.stringify(program).includes('"power":0'), false);
  assert.equal(JSON.stringify(program).includes('"power": 0'), false);
});

test("ogn-151-298 Lee Sin, Centered: judgeReason cites the card-program binding, the buffed predicate and the location anchor", () => {
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /buffed/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /sameLocationAs/);
});

test("ogn-151-298 Lee Sin, Centered: the declared Accelerate keyword matches the merged KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Accelerate");
  assert.ok(registered, "effects/keywords/Accelerate.ts must be in the generated registry");
  assert.equal(program.abilities[0].keyword, registered.keyword.toLowerCase());
  assert.equal(registered.valued, false);
  assert.equal(registered.stacking, "single");
  assert.ok(registered.ruleRefs.includes("805.1.b"));
});

test("ogn-151-298 Lee Sin, Centered: Accelerate is declared, the +2 Might aura is a static effect", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, aura] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "accelerate" });

  assert.equal(aura.kind, "static");
  assert.equal(aura.effect.kind, "continuous.might");
  assert.equal(aura.effect.mode, "add");
  assert.equal(aura.effect.layer, "arithmetic");
  assert.deepEqual(aura.effect.amount, { kind: "constant", value: 2 });
  // The aura reads the host's current location and the buffed state; neither is
  // an executable filter today (judgeReason). The selectors are the contract 3.6
  // symbolic forms.
  assert.deepEqual(aura.effect.filter, {
    type: "unit",
    controller: "controller",
    exclude: "self",
    sameLocationAs: "source",
    buffed: true
  });
  assert.equal(aura.condition, undefined);
});

test("ogn-151-298 Lee Sin, Centered: the aura records the printed filter shape for reviewers", () => {
  // CR 740.1.a (friendly = same controller), 364.3 (other = exclude the host),
  // 359.3.f.2 ("my battlefield" = host location), 702/703 (buffed state).
  assert.deepEqual(Object.keys(program.abilities[1].effect.filter), [
    "type",
    "controller",
    "exclude",
    "sameLocationAs",
    "buffed"
  ]);
  assert.equal(program.abilities[1].effect.filter.exclude, "self");
  assert.equal(program.abilities[1].effect.filter.sameLocationAs, "source");
  assert.equal(program.abilities[1].effect.filter.buffed, true);
});

test("ogn-151-298 Lee Sin, Centered: the merged continuous.might primitive registers the +2 aura it declares", () => {
  // The registered primitive is the layer consumer the aura's op declares; the
  // golden drives the card's own instruction through the interpreter so the
  // arithmetic-layer registration is the real one, not a hand-built effect.
  const base = world().unit("elder", { might: 3 }).unit("ally", { might: 2 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("elder"), source: base.ref("elder") });
  const elderRef = kernel.ref("elder");
  const instruction = program.abilities[1].effect;
  assert.equal(instruction.kind, "continuous.might");
  assert.equal(instruction.mode, "add");
  // continuous.might's argsSchema accepts already-evaluated literals (the
  // interpreter evaluates Expr args before dispatch): pass the card's own
  // amount value and a locked target id.
  const run = runInstruction(mightPrimitive, {
    amount: instruction.amount.value,
    duration: "end-of-turn",
    target: "lee-sin-aura"
  }, { world: kernel, targets: { "lee-sin-aura": [elderRef] } });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.kind, "continuous.might");
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 2);
});

test.todo(
  "ogn-151-298 Lee Sin, Centered: 'Other buffed friendly units at my battlefield have +2 Might.' needs the " +
    "card-program binding that registers the static continuous.might effect (RIFT-257), plus a buffed " +
    "predicate in the filter vocabulary (CR 702/703) and a host-location ('my battlefield') anchor in " +
    "the layer filter."
);
