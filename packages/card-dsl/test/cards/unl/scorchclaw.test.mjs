import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/scorchclaw.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { createLayerEngine, ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/index.js";

const CANONICAL_ID =
  "card.hash-2958889db75762be77762e57c20843ec822b4e17041923975b21d9edc0fd4494";
const SOURCE_TEXT =
  "[Hunt 2] (When I conquer or hold, gain 2 XP.)\n" +
  "[Level 3][>] I have +1 :rb_might: and enter ready. (While you have 3+ XP, get the effect.)";

const [hunt, levelMight, levelEnterReady] = program.abilities;
const enterReadyInstruction = levelEnterReady.with[0];

test("unl-016-219 Scorchclaw: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-016-219 Scorchclaw: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Hunt/);
  assert.match(program.judgeReason, /824\.1/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /condition\.predicate/);
});

test("unl-016-219 Scorchclaw: [Hunt 2] declares the printed Hunt Value as a keyword only", () => {
  assert.equal(program.abilities.length, 3);
  // 823.1.b / 823.1.c: Hunt is both a Conquer and a Hold effect formatted as
  // "Hunt X"; the printed X is 2 (823.1.c.2's default of 1 does not apply).
  assert.deepEqual(hunt, { kind: "keyword", keyword: "hunt", value: 2 });
  // README section 5: the conquer/hold trigger and "gain X XP" expansion belong
  // to effects/keywords/Hunt.ts, not to this card file; the card declares only
  // the keyword and its value.
  assert.equal(Object.keys(hunt).sort().join(","), "keyword,kind,value");
});

test("unl-016-219 Scorchclaw: [Level 3][>] carries the +1 Might branch gated on 3 XP", () => {
  // 824.1.b / 824.1.b.1: the whole clause after the keyword is the Level Ability,
  // functionally "While you have 3 or more XP, this card gains '[Text]'".
  assert.equal(levelMight.kind, "static");
  assert.equal(levelMight.effect.kind, "continuous.might");
  assert.equal(levelMight.effect.mode, "add");
  assert.equal(levelMight.effect.layer, "arithmetic");
  assert.equal(levelMight.effect.appliesTo, "self");
  assert.deepEqual(levelMight.effect.amount, { kind: "constant", value: 1 });
  assert.equal(levelMight.condition.kind, "compare");
  assert.equal(levelMight.condition.operator, "gte");
  assert.deepEqual(levelMight.condition.right, { kind: "constant", value: 3 });
  assert.equal(levelMight.condition.left.kind, "count");
  assert.equal(levelMight.condition.left.subject, "controller-xp");
});

test("unl-016-219 Scorchclaw: [Level 3][>] also carries the enter-ready branch at the same 3 XP gate", () => {
  // 824.1.b.1: "and enter ready" is the second part of the same Level Ability; it
  // is an entry replacement (359.2.c / 369.3), not a post-entry effect.ready.
  assert.equal(levelEnterReady.kind, "replacement");
  assert.deepEqual(levelEnterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.equal(levelEnterReady.condition.kind, "compare");
  assert.equal(levelEnterReady.condition.operator, "gte");
  assert.deepEqual(levelEnterReady.condition.right, { kind: "constant", value: 3 });
  assert.equal(levelEnterReady.condition.left.subject, "controller-xp");
  assert.equal(levelEnterReady.with.length, 1);
  assert.equal(enterReadyInstruction.id, "scorchclaw.enter-ready");
  assert.equal(enterReadyInstruction.op, "effect.ready");
  assert.deepEqual(enterReadyInstruction.args.objects, {
    kind: "constant",
    value: { kind: "source" }
  });
});

test("unl-016-219 Scorchclaw: the replacement body's effect.ready readies the source", () => {
  const kernel = world()
    .unit("scorchclaw", { zone: "board", controller: "A", exhausted: true, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("scorchclaw")) });
  const outcome = resolveChainBody(levelEnterReady.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["scorchclaw.enter-ready", "executed"]
  ]);
  assert.deepEqual(scoped.events.map(event => event.action), ["ready"]);
  assert.equal(scoped.object(scoped.ref("scorchclaw")).exhausted, false);
});

test("unl-016-219 Scorchclaw golden: the merged [Hunt 2] expansion pays 2 XP through the interpreter (CR 823.1.c.1)", () => {
  // 823.1.c.1: Hunt is "When I Conquer or Hold, my controller gains X XP"; the
  // merged KeywordDef expands it into one trigger per timing point whose body is
  // the merged effect.xp primitive. The subscription side stays open below.
  const huntDefinition = keywordDefinitionsById.get("Hunt");
  assert.ok(huntDefinition, "effects/keywords/Hunt.ts must be registered");
  assert.equal(huntDefinition.stacking, "sum");
  const expansions = huntDefinition.expand({ value: hunt.value, host: { canonicalCardId: CANONICAL_ID } });
  assert.deepEqual(expansions.map((ability) => ability.trigger.at), ["conquer", "hold"]);

  for (const ability of expansions) {
    const kernel = world().player("A", { xp: 0 }).build();
    const outcome = resolveChainBody(ability.body, kernel);
    assert.equal(outcome.results[0].result.status, "executed");
    // 823.1.c.2: the printed X is 2, so the omitted-value default of 1 is unused.
    assert.equal(outcome.results[0].result.linkedValues.gained, 2);
    assert.equal(kernel.player("A").xp, 2);
  }
});

test("unl-016-219 Scorchclaw golden: the Level +1 Might registers a real arithmetic-layer continuous effect (CR 143.2.a / 475)", () => {
  // The card's own static ability (not the aggregate declaration) is exercised:
  // its continuous.might instruction is executed by the merged interpreter and
  // the registration is consumed by the switched-on layer engine.
  const instruction = {
    id: "scorchclaw.level-might",
    op: "continuous.might",
    args: {
      mode: levelMight.effect.mode,
      amount: levelMight.effect.amount,
      objects: { kind: "constant", value: { kind: "target", id: "scorchclaw.self" } }
    },
    targets: [
      {
        id: "scorchclaw.self",
        filter: { type: "unit" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]
  };
  const kernel = world().unit("scorchclaw", { owner: "A", might: 3 }).build();
  kernel.setTargets("scorchclaw.self", [kernel.ref("scorchclaw")]);
  const context = kernel.clone({ sourceSnapshot: kernel.getObject("scorchclaw") });
  const outcome = resolveChainBody([instruction], context);
  assert.equal(outcome.results[0].result.status, "executed");

  const registrations = context.continuousEffects.map((entry, index) => ({
    effect: entry.effect,
    duration: entry.duration,
    timestamp: index + 1
  }));
  const layered = createLayerEngine(context.objects, registrations).evaluate(context.ref("scorchclaw"));
  assert.equal(layered.might, 4);
  assert.equal(registrations[0].effect.effect.kind, "continuous.might");
  assert.equal(registrations[0].effect.layer, "arithmetic");
});

test("unl-016-219 Scorchclaw golden: the Level 'enter ready' branch binds a real board-entry replacement (CR 359.2.c / 369.3)", () => {
  const kernel = world()
    .unit("scorchclaw", { zone: "hand", types: ["unit"], exhausted: false, power: ["Fury"] })
    .build();
  const hostRef = kernel.ref("scorchclaw");
  const registrations = [];
  const bound = bindReplacement(levelEnterReady, hostRef, {
    host: {
      object: (ref) => kernel.object(ref),
      objects: () => kernel.objects,
      context: () => kernel
    },
    pipeline: {
      clock: { turn: 1 },
      registerReplacement: (registration) => registrations.push(registration)
    }
  });
  assert.equal(registrations.length, 1);

  // The card is played: it moves from Hand to the Chain, which is where the
  // binding follows the newest incarnation (CR 350.2 / 354).
  assert.equal(kernel.perform({ type: "move-zone", object: hostRef, to: "chain" }).status, "done");
  const chainIncarnation = kernel.ref("scorchclaw");
  assert.equal(kernel.getObject("scorchclaw").exhausted, false);
  assert.equal(kernel.perform({ type: "exhaust", object: chainIncarnation }).status, "done");

  const entering = {
    type: "move-zone",
    object: chainIncarnation,
    to: "base",
    location: { type: "base", player: "A" }
  };
  assert.equal(bound.registration.matches(entering, entering), true);
  const applied = bound.registration.apply(entering, entering);
  assert.equal(applied.status, "replace");
  // 805.6.a shape: the entry orientation is corrected on the chain-zone
  // permanent and the move then carries it to the Board.
  assert.deepEqual(applied.actions.map((action) => action.type), ["ready", "move-zone"]);
  for (const action of applied.actions) assert.equal(kernel.perform(action).status, "done");
  const entered = kernel.getObject("scorchclaw");
  assert.equal(entered.zone, "board");
  assert.equal(entered.exhausted, false);
});

test("unl-016-219 Scorchclaw: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-016-219 Scorchclaw: expand [Hunt 2] into a Conquer and Hold trigger that gains 2 XP through effect.xp " +
    "(CR 823.1.b / 823.1.c.1) — effects/keywords/Hunt.ts is merged and its body is executed above; what is still " +
    "open is the subscription side: conquer/hold timing points do not reach the card trigger registry and RIFT-257 " +
    "does not register a card's keyword abilities at runtime"
);

test.todo(
  "unl-016-219 Scorchclaw: activate [Level 3][>] (CR 824.1.b.1 / 824.1.c / 824.1.d) with its 3+ XP predicate and " +
    "dynamic Active/Inactive re-evaluation — effects/keywords/Level.ts publishes a condition.predicate that the layer " +
    "condition vocabulary (always/never/type/has-tag/has-keyword) does not consume"
);

test.todo(
  "unl-016-219 Scorchclaw: apply the Level +1 Might in the arithmetic layer once the XP gate holds (CR 143.2.a / 475) " +
    "— the continuous.might registration itself is executed above; no production path registers a card's static " +
    "abilities into layers (RIFT-257)"
);

test.todo(
  "unl-016-219 Scorchclaw: register the Level 'enter ready' board-entry replacement from the card program " +
    "(CR 359.2.c / 369.3) — bindReplacement consumes the ability above, but nothing registers a card's " +
    "ReplacementAbility in production (RIFT-257); effect.ready does not substitute for it"
);
