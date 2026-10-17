import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/the-academy.js";
import { cardProgramsById } from "../../../dist/cards/registry.generated.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import repeatDefinition from "../../../../engine-core/dist/effects/keywords/Repeat.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-3c0bf04f347717e5a304a3188f6fa00eb657fea304747bef8f5c004ecf3679ab";
const SOURCE_TEXT =
  "When you hold here, give your next spell this turn [Repeat] equal to its base cost. " +
  "(You may pay the additional cost to repeat the spell's effect.)";

const [ability] = program.abilities;
const [grant] = ability.body;

test("unl-216-219 The Academy: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("unl-216-219 The Academy: identity, ruleset, status and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardProgramsById.get(program.canonicalCardId), program);
});

test("unl-216-219 The Academy: judgeReason names the one-shot window, base cost and grant gaps", () => {
  assert.match(program.judgeReason, /one-shot|next spell/);
  assert.match(program.judgeReason, /204\.1\.a/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /attachLifecycle/);
  assert.match(program.judgeReason, /FinalizedCostPlan/);
  assert.match(program.judgeReason, /here|Battlefield/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("unl-216-219 The Academy: a hold trigger at this Battlefield for its controller", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  // 383.4.d / 471.2 / 473.2.b: a Hold Effect put on the chain when the
  // controller of the triggering source has held; 053.3 supplies "here" and
  // 190.6.d makes "you" the Battlefield's controller. "held" is the closed
  // EVENT_PATTERN_TYPES spelling for the hold timing point and "self" is the
  // accepted player selector; the here-binding is the remaining gap.
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, {
    event: "held",
    filter: { source: "self" },
    player: "self"
  });
  assert.equal(ability.trigger.once, undefined);
  assert.equal(ability.trigger.condition, undefined);
  assert.equal(ability.optional, false);
});

test("unl-216-219 The Academy: the printed grant names Repeat, the base cost and this turn", () => {
  assert.deepEqual(ability.body.map(instruction => instruction.id), [
    "the-academy.grant-repeat"
  ]);
  // 479.3.b: "give" is the identifying phrase of the Ability-Altering layer;
  // 820.1/820.1.a make [Repeat] an Optional Additional Cost keyword on spells.
  assert.equal(grant.op, "continuous.grant-keyword");
  assert.deepEqual(grant.args.keyword, { kind: "constant", value: "Repeat" });
  // 391.4: "the next spell you play this turn" is the printed window of a
  // Delayed Passive Ability, and 204.1.a/206 make "its base cost" the printed
  // cost of that later spell. Both stay reviewable data here.
  assert.deepEqual(grant.args.appliesTo, {
    kind: "constant",
    value: {
      window: "next-spell-you-play-this-turn",
      cost: { source: "base-cost-of-that-spell" }
    }
  });
  assert.deepEqual(grant.args.duration, { kind: "constant", value: "end-of-turn" });
  // The recipient is played later than this trigger (355.5 forbids locking it
  // at Finalize) and the selector vocabulary has no "next played" form, so the
  // program declares no TargetSpec and invents no reference.
  assert.equal(grant.targets, undefined);
  assert.equal(grant.picks, undefined);
  assert.equal(grant.linkedTo, undefined);
  assert.equal(grant.condition, undefined);
});

test("unl-216-219 The Academy: the card is not a Repeat spell itself", () => {
  // 820.1.a: Repeat is present on Spells and Abilities. Declaring it on the
  // Battlefield would change what the card says; it belongs to the next spell
  // the controller plays, which is why the merged Repeat KeywordDef is the
  // definition the grant refers to rather than a re-implementation.
  assert.equal(
    program.abilities.some(value => value.kind === "keyword"),
    false
  );
  assert.equal(grant.args.keyword.value, "Repeat");
});

test("unl-216-219 The Academy: the merged Repeat definition is the printed optional additional cost", () => {
  // The merged KeywordDef is the single place that turns [Repeat] into the
  // printed optional additional cost (820.1); the grant only names it.
  assert.equal(repeatDefinition.keyword, "Repeat");
  assert.equal(repeatDefinition.valued, false);
  assert.equal(repeatDefinition.stacking, "separate");
  assert.ok(repeatDefinition.ruleRefs.includes("820.1"));
  assert.ok(repeatDefinition.ruleRefs.includes("820.1.a"));
  assert.ok(repeatDefinition.ruleRefs.includes("820.1.c"));
  // "equal to its base cost" is per-instance cost data of the spell that
  // carries Repeat (820.1.c); the keyword definition is the single place
  // that turns it into an ability, and no cost is invented here.
  const expanded = repeatDefinition.expand({
    host: { canonicalCardId: CANONICAL },
    cost: { kind: "additional-cost", source: "base-cost-of-that-spell" }
  });
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].kind, "static");
  assert.equal(expanded[0].effect.kind, "repeat.cost");
});


test("unl-216-219 The Academy golden: the held pattern retains the source Battlefield anchor", async () => {
  // The event name is closed vocabulary, while the nested source:self filter
  // preserves CR 053.3 "here" for the registration layer.
  const pattern = ability.trigger.filter;
  assert.equal(pattern.event, "held");
  assert.deepEqual(pattern.filter, { source: "self" });
  const { translateTriggerFilter } = await import("../../../../engine-core/dist/programs/filters.js");
  const translated = translateTriggerFilter(pattern, "the-academy-source");
  assert.equal(translated.event, "held");
  assert.equal(translated.player, "self");
  assert.deepEqual(translated.object, { objectId: "the-academy-source" });
});

test("unl-216-219 The Academy fail-closed: the delayed recipient descriptor is not accepted by the merged grant instruction", () => {
  const kernel = world().build();
  assert.throws(
    () => runInstruction(grantKeyword, grant.args, { world: kernel }),
    /continuous\.grant-keyword appliesTo must evaluate to "self"/
  );
});

test.todo(
  "unl-216-219 The Academy: install [Repeat] on the next spell the controller plays this turn " +
    "(CR 391.4, 479.3.b) — needs the one-shot 'next spell this turn' window, which no ObjectSelector, " +
    "ObjectFilter or Duration can express (same gap as ogn/raging-firebrand)"
);

test.todo(
  "unl-216-219 The Academy: build the granted Repeat's additional cost from the base cost of that " +
    "later spell (CR 204.1.a, 206, 356.1, 820.1.c.1) — cost.modify and ignoreAllCosts are merged, " +
    "but the delayed grant still lacks a finalized FinalizedCostPlan path that reads this spell's printed " +
    "base cost and offers the optional additional payment to Finalize"
);

test.todo(
  "unl-216-219 The Academy: execute the delayed grant and hold trigger in the production room " +
    "(CR 190.6.a/190.6.d, 053.3) — createProgramBinding.attachLifecycle already registers supplied " +
    "programs, but the hold emission lacks the source/Battlefield binding and the default room does not " +
    "inject this CardProgram; the next-spell window remains unresolved"
);
