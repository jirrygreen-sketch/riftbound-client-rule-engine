// Execution evidence for keyword expansion is consolidated in ../templates/keyword-only.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/gemhand-hunter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { validateCardProgram as validateExpansion } from "../../../dist/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import xp from "../../../../engine-core/dist/effects/instructions/effect.xp.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";

const CANONICAL_ID =
  "card.hash-ab13903af22d097efdc5e4e666b4055e6ef532fd5138f05aef5bd99a8ae78a8c";
const SOURCE_TEXT =
  "[Hunt] (When I conquer or hold, gain 1 XP.)\n" +
  "[Level 6][>] I have +1 :rb_might:. (While you have 6+ XP, get the effect.)";

const [hunt, level] = program.abilities;

test("unl-094-219 Gemhand Hunter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-094-219 Gemhand Hunter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /823/);
  assert.match(program.judgeReason, /Level/);
  assert.match(program.judgeReason, /824/);
  assert.match(program.judgeReason, /controller-xp/);
  assert.doesNotMatch(program.judgeReason, /RIFT-120|RIFT-91/);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("unl-094-219 Gemhand Hunter: [Hunt] omits its value and [Level 6] carries the threshold", () => {
  assert.equal(program.abilities.length, 2);
  // 823.1.c.2: an omitted Hunt value is Hunt 1, so the keyword declaration
  // carries no `value` (README section 5).
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt" });
  assert.equal(hunt.value, undefined);
  // 824.1.a: the printed "[Level 6][>]" carries the XP threshold.
  assert.deepEqual(level, { kind: "keyword", keyword: "level", value: 6 });
});

test("unl-094-219 Gemhand Hunter: merged Hunt and Level definitions expand the declarations", () => {
  const huntDefinition = keywordDefinitionsById.get("Hunt");
  assert.ok(huntDefinition, "the merged Hunt KeywordDef is registered");
  assert.equal(huntDefinition.valued, true);
  assert.equal(huntDefinition.stacking, "sum");
  const huntExpansion = huntDefinition.expand({ value: hunt.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(huntExpansion.map(entry => entry.trigger.at), ["conquer", "hold"]);
  for (const entry of huntExpansion) {
    assert.equal(entry.kind, "triggered");
    assert.equal(entry.body[0].op, "effect.xp");
    assert.deepEqual(entry.body[0].args.amount, { kind: "constant", value: 1 });
  }
  const validatedHunt = validateExpansion({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: huntExpansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(validatedHunt.issues, []);
  assert.equal(validatedHunt.ok, true);

  const levelDefinition = keywordDefinitionsById.get("Level");
  assert.ok(levelDefinition, "the merged Level KeywordDef is registered");
  assert.equal(levelDefinition.valued, true);
  assert.equal(levelDefinition.stacking, "separate");
  const levelExpansion = levelDefinition.expand({ value: level.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(levelExpansion.length, 1);
  const [predicate] = levelExpansion;
  assert.equal(predicate.kind, "static");
  assert.equal(predicate.effect.kind, "condition.predicate");
  assert.equal(predicate.effect.query, "controller-xp");
  assert.deepEqual(predicate.effect.threshold, { kind: "constant", value: 6 });
  const validatedLevel = validateExpansion({
    canonicalCardId: CANONICAL_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: levelExpansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(validatedLevel.issues, []);
  assert.equal(validatedLevel.ok, true);
});

test("unl-094-219 Gemhand Hunter golden: the merged Hunt XP instruction executes", () => {
  const huntDefinition = keywordDefinitionsById.get("Hunt");
  assert.ok(huntDefinition);
  const [conquerTrigger] = huntDefinition.expand({ host: { canonicalCardId: CANONICAL_ID } });
  const kernel = world().player("A", { xp: 2 }).build();
  const run = runInstruction(xp, conquerTrigger.body[0].args, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").xp, 3);
  assert.deepEqual(run.events.map(event => event.action), ["gain-xp"]);
});

test("unl-094-219 Gemhand Hunter golden: both Hunt bodies award their source controller exactly 1 XP", () => {
  const definition = keywordDefinitionsById.get("Hunt");
  assert.ok(definition);
  // Execute the expanded bodies only; scoring-unit attribution remains a TODO.
  for (const trigger of definition.expand({ host: { canonicalCardId: CANONICAL_ID } })) {
    const kernel = world().player("A", { xp: 4 }).player("B", { xp: 5 })
      .unit("hunter", { owner: "A", controller: "B", cardId: CANONICAL_ID })
      .build();
    const context = kernel.clone({ sourceSnapshot: kernel.getObject("hunter"), controller: "B" });
    const outcome = resolveChainBody(trigger.body, context);
    assert.equal(outcome.status, "executed");
    assert.equal(context.player("A").xp, 4);
    assert.equal(context.player("B").xp, 6);
    assert.equal(outcome.linkedValues[`${encodeURIComponent(trigger.body[0].id)}.gained`], 1);
    assert.equal(outcome.linkedValues[`${encodeURIComponent(trigger.body[0].id)}.gainedTo`], "B");
    assert.deepEqual(outcome.events.map(event => event.action), ["gain-xp"]);
  }
});

test.todo(
  "unl-094-219 Gemhand Hunter: attribute the expanded Hunt triggers to the unit that conquered or held — " +
    "the scoring emission carries player/battlefieldId but no source unit object (CR 823.1.b / 383.4.c.2 / 383.4.d.2)"
);
test.todo(
  "unl-094-219 Gemhand Hunter: activate the dependent ability when the controller has 6+ XP (CR 824.1.c / " +
    "824.1.d) — the merged Condition cannot read player XP and no binder attaches the [Level 6] text"
);
test.todo(
  "unl-094-219 Gemhand Hunter: apply 'I have +1 :rb_might:' through the continuous.might arithmetic layer " +
    "(CR 824.1.b.1 / 143.2.a) — the Level dependent-ability binder is still missing"
);
