import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/unl/soul-shepherd.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL =
  "card.hash-bd9ef27aeff0a310c407d20aaac7113859f60260060aac163b4025ea2e70bf4c";
const SOURCE_TEXT = "Your token units have +1 :rb_might:.";

const [ability] = program.abilities;
const { effect } = ability;

test("unl-077-219 Soul Shepherd: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-077-219 Soul Shepherd: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /isToken/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("unl-077-219 Soul Shepherd: a static arithmetic Might aura over your token units", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.condition, undefined);
  assert.equal(effect.kind, "continuous.might");
  assert.equal(effect.mode, "add");
  assert.equal(effect.layer, "arithmetic");
  assert.deepEqual(effect.amount, { kind: "constant", value: 1 });
  // "Your token units"：friendly（740.1.a 的 your）+ token 特征判定。
  assert.deepEqual(effect.filter, {
    zone: "board",
    type: "unit",
    controller: "controller",
    isToken: true
  });
});

test("unl-077-219 Soul Shepherd golden: the merged continuous.might op registers the supported unit filter", () => {
  const kernel = world()
    .unit("soul-shepherd", { might: 3, controller: "A" })
    .unit("token", { might: 1, controller: "A", isToken: true })
    .unit("vanilla", { might: 1, controller: "A", isToken: false })
    .unit("enemy", { might: 1, controller: "B", owner: "B", isToken: true })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("soul-shepherd") });
  const resolvedFilter = { ...effect.filter, controller: "A" };
  delete resolvedFilter.isToken;
  const outcome = runAbilityBody([{
    id: "soul-shepherd.might",
    op: "continuous.might",
    args: {
      amount: effect.amount,
      filter: { kind: "constant", value: resolvedFilter }
    }
  }], context);
  assert.equal(outcome.status, "executed");
  const layers = createLayerEngine(context.objects, context.continuousEffects);
  assert.equal(layers.evaluate(context.ref("token")).might, 2);
  assert.equal(layers.evaluate(context.ref("vanilla")).might, 2);
});

test.todo(
  "unl-077-219 Soul Shepherd: 'Your token units have +1 :rb_might:.' needs the continuous.might layers " +
    "card-program registration path (RIFT-91); the merged op execution is covered above"
);
test.todo(
  "unl-077-219 Soul Shepherd: the token membership test needs a real isToken filter; today the layers " +
    "filter ignores the key, so a non-token unit would also receive +1 :rb_might:"
);
