import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/akali-silent.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-cbfb311a21f9513fabec6e5988abd82142daa5583c2f6638ef10ecc4244c44bc";
const SOURCE_TEXT =
  "I can't be chosen by enemy spells and abilities unless I'm in combat.\n" +
  "When I move to a battlefield, give me +2 :rb_might: this turn.";

const [restriction, ability] = program.abilities;
const [might] = ability.body;

test("ven-038-166 Akali, Silent: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
});

test("ven-038-166 Akali, Silent: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /combatRole/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /host\.testTrigger/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("ven-038-166 Akali, Silent: 'I can't be chosen by enemy spells and abilities unless I'm in combat' is a passive targeting restriction", () => {
  // 355.9.b (and its worked example about a unit that reads exactly this line)
  // makes the prohibition a targeting restriction; 054/054.1 mean it removes
  // options without granting anything.
  assert.equal(restriction.kind, "static");
  assert.deepEqual(restriction.effect, {
    kind: "continuous.target-restriction",
    forbids: "chosen-as-target",
    by: "enemy-spells-and-abilities",
    unless: "self-in-combat",
    appliesTo: "self"
  });
  assert.equal(restriction.condition, undefined);
});

test("ven-038-166 Akali, Silent: 'When I move to a battlefield' subscribes to object-moved with the battlefield destination", () => {
  // 383.1 / 421.1 / 449.1 / 449.2: a Move is defined by its origin and
  // destination; 458/458.1 keep Recall out of Move triggers.
  assert.equal(program.abilities.length, 2);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-moved");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-moved",
    toZone: "battlefield",
    filter: { source: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.trigger.once, undefined);
});

test("ven-038-166 Akali, Silent: the body is the documented +2 Might this-turn shape, never a Buff counter", () => {
  // 143.2.a reads Effective Might; the temporary change lives in the arithmetic
  // layer and expires in this turn's cleanup (317.2.c). effect.buff's own
  // boundary note keeps Buff counters (702/703) out of Might changes.
  assert.equal(might.id, "akali-silent.might-this-turn");
  assert.equal(might.op, "continuous.might");
  assert.deepEqual(might.args, {
    mode: { kind: "constant", value: "add" },
    amount: { kind: "constant", value: 2 },
    duration: { kind: "constant", value: "this-turn" },
    appliesTo: { kind: "constant", value: "self" }
  });
  assert.equal(might.targets, undefined);
  assert.equal(might.picks, undefined);
  // appliesTo: "self" binds the ability host (ResolveContext.source);
  // the card no longer carries the unsupported layer/object arg keys.
});

test("ven-038-166 Akali, Silent: the object-moved event matcher honours the battlefield destination", () => {
  // 449.1/449.2 + the closed EventPattern surface: the event carries toZone, so
  // "to a battlefield" is a real event filter, not a descriptive key.
  const pattern = ability.trigger.filter;
  const base = {
    ref: { id: "akali", zoneEntryId: 1 },
    cardId: "card:ven-038-166",
    name: "Akali",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf-1" },
    might: 4,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const toBattlefield = { kind: "object-moved", timingPoint: "object-moved", object: base, controller: "A", toZone: "battlefield" };
  const toBase = { ...toBattlefield, toZone: "base" };
  assert.equal(matchesTriggerEvent(pattern, toBattlefield, "A"), true);
  assert.equal(matchesTriggerEvent(pattern, toBase, "A"), false);
});


test("ven-038-166 golden: continuous.might really adds +2 Might this turn (RIFT-258)", () => {
  // The merged continuous.might primitive executes the card's actual IR shape;
  // the Empowered gate is not involved here, but the +2 this-turn body is real.
  const kernel = world()
    .unit("akali-silent", { controller: "A", might: 4 })
    .build();
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("akali-silent") });
  const outcome = resolveChainBody(ability.body, context);
  assert.equal(outcome.status, "executed");
  assert.equal(context.continuousEffects.length, 1);
  assert.equal(context.continuousEffects[0].effect.layer, "arithmetic");
  assert.deepEqual(context.continuousEffects[0].effect.effect.amount, 2);
  // this-turn resolves to the end-of-turn duration alias.
  assert.deepEqual(context.continuousEffects[0].duration, { type: "end-of-turn" });

  const layers = createLayerEngine(context.objects, context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  })));
  assert.equal(layers.evaluate(context.ref("akali-silent")).might, 6);
});

test.todo(
  "ven-038-166 Akali, Silent: enforce the 355.9.b targeting restriction and its 'unless I'm in combat' " +
    "exception in the target plan — no continuous.target-restriction consumer, no combatRole on " +
    "ObjectSnapshot (contract 3.8), and no card-program -> ContinuousEffectSpec producer (RIFT-90/RIFT-91)"
);

test.todo(
  "ven-038-166 Akali, Silent: resolve 'When I move to a battlefield' end to end (143.2.a / 317.2.c) — the merged " +
    "continuous.might primitive executes +2 (see the golden); static trigger registration landed via RIFT-257,\n" +
    "but the object-moved payload lacks toZone and the condition path needs host.testTrigger (fail-closed)"
);
