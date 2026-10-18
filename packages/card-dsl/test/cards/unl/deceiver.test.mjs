import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/deceiver.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { translateInstructionTargets, translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-6ea8e63a198fef36cfbb65b0e39e0cf0f4206a9abd810a75bf107bcaad25da29";
const SOURCE_TEXT =
  "When you conquer or hold, you may discard 1 and exhaust me to play a ready Reflection unit token there. " +
  "It becomes a copy of another unit there. Give it [Temporary].";

const [conquer, hold] = program.abilities;
const [conquerMay] = conquer.body;
const [conquerPay, conquerToken, conquerCopy, conquerTemporary] =
  conquerMay.args.body.value;
const [holdMay] = hold.body;
const [holdPay, holdToken, holdCopy, holdTemporary] = holdMay.args.body.value;

test("unl-199-219 Deceiver: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-199-219 Deceiver: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /383\.3\.b/);
  assert.match(program.judgeReason, /TriggeredAbility|Finalize/);
  assert.match(program.judgeReason, /ready|there/);
  assert.match(program.judgeReason, /Temporary/);
  // The registered event vocabulary and the four live gaps must be named.
  assert.match(program.judgeReason, /conquered/);
  assert.match(program.judgeReason, /held/);
  assert.match(program.judgeReason, /entry override/);
  assert.match(program.judgeReason, /began-start|beginning-start/);
});

test("unl-199-219 Deceiver: 'conquer or hold' is two named triggers with the §3.9 may wrapper", () => {
  assert.equal(program.abilities.length, 2);
  // 383.4.c.2.b: a Conquer Effect that references the player conquering.
  assert.equal(conquer.kind, "triggered");
  assert.equal(conquer.trigger.at, "conquer");
  // TriggerSpec's EVENT_PATTERN_TYPES spells the conquer timing "conquered";
  // events/pipeline-match.ts maps the conquer timing to that event name.
  assert.deepEqual(conquer.trigger.filter, { event: "conquered", player: "self" });
  assert.equal(conquer.optional, true);
  // 383.4.d.2.b: a Hold Effect that references the player holding.
  assert.equal(hold.kind, "triggered");
  assert.equal(hold.trigger.at, "hold");
  assert.deepEqual(hold.trigger.filter, { event: "held", player: "self" });
  assert.equal(hold.optional, true);

  for (const [may, ids] of [
    [
      conquerMay,
      [
        "deceiver.conquer-pay",
        "deceiver.conquer-play-token",
        "deceiver.conquer-copy",
        "deceiver.conquer-grant-temporary"
      ]
    ],
    [
      holdMay,
      [
        "deceiver.hold-pay",
        "deceiver.hold-play-token",
        "deceiver.hold-copy",
        "deceiver.hold-grant-temporary"
      ]
    ]
  ]) {
    // Contract 3.9: the chosen instructions are wrapped inside the optional body.
    assert.equal(may.op, "choice.optional");
    assert.equal(may.linkedTo, undefined);
    assert.equal(may.args.body.kind, "constant");
    assert.deepEqual(may.args.body.value.map(instruction => instruction.id), ids);
  }
});

test("unl-199-219 Deceiver: the base cost keeps discard 1 and exhaust me as one declarative cost plan", () => {
  for (const [pay, suffix] of [
    [conquerPay, "deceiver.conquer-pay"],
    [holdPay, "deceiver.hold-pay"]
  ]) {
    // 383.3.b / 204.3: a cost within instructions right after the leading "you
    // may" is the trigger's base cost, paid at Finalize. The merged cost.pay
    // primitive keeps this declarative shape until the trigger Finalize adapter
    // can consume it.
    assert.equal(pay.op, "cost.pay");
    assert.equal(pay.linkedTo, undefined);
    assert.deepEqual(pay.args.payments, {
      kind: "constant",
      value: [
        // 423.1.a / 355.10.a: the discarding player privately picks one Hand
        // card; the cost does not target anything (355.10.c.1).
        { kind: "discard", amount: 1 },
        // 415.4 / 415.5: "exhaust me" is a cost and must be completable.
        { kind: "exhaust", object: "self" }
      ]
    });
    assert.equal(suffix, pay.id);
  }
});

test("unl-199-219 Deceiver: the Reflection token play keeps the chain-create and ready-entry stipulations", () => {
  for (const [token, pay] of [
    [conquerToken, conquerPay],
    [holdToken, holdPay]
  ]) {
    assert.equal(token.op, "effect.token");
    // 187.6: Reflection is the 0 [M] domainless unit token in the merged table.
    assert.deepEqual(token.args.token, { kind: "constant", value: "reflection" });
    assert.deepEqual(token.args.amount, { kind: "constant", value: 1 });
    // 440.2.c / 185.2.a: a token that is "played" is created on the Chain first.
    assert.deepEqual(token.args.mode, { kind: "constant", value: "play" });
    // "there" = the battlefield of the triggering event (359.3.f.1). The sealed
    // conquer / hold payloads declare no battlefield field, so the placeholder
    // location only records the shape (see judgeReason).
    assert.deepEqual(token.args.location, {
      kind: "constant",
      value: { type: "battlefield", id: "that-battlefield" }
    });
    // 143.4 / 184.1: "ready" is an entry-state override; the merged token
    // primitive still has no entry override, so there is no create-then-ready substitute.
    assert.deepEqual(Object.keys(token.args).sort(), [
      "amount",
      "linkKey",
      "location",
      "mode",
      "token"
    ]);
    // The play follows the paid base cost (359.3.e.14 linking).
    assert.equal(token.linkedTo, pay.id);
  }
});

test("unl-199-219 Deceiver: the copy instruction targets another unit and transforms the created token", () => {
  for (const [copy, prefix] of [
    [conquerCopy, "deceiver.conquer"],
    [holdCopy, "deceiver.hold"]
  ]) {
    assert.equal(copy.op, "effect.copy");
    // 446.1-446.2: the copy applies to an already existing object; effect.copy's
    // "effect" mode is explicitly blocked (see judgeReason), so nothing here is
    // executed as a Create.
    assert.deepEqual(copy.args.mode, { kind: "constant", value: "effect" });
    assert.deepEqual(copy.args.onto, {
      kind: "constant",
      value: { linked: prefix + "-play-token" }
    });
    assert.deepEqual(copy.args.duration, { kind: "constant", value: "permanent" });
    // 355.9 / 355.10: "another unit there" is an explicitly named object, so it
    // is a target; "there" is a battlefield location restriction.
    assert.deepEqual(copy.targets, [
      {
        id: prefix + "-other-unit",
        filter: { type: "unit", zone: "board", location: "battlefield" },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]);
    assert.equal(copy.picks, undefined);
  }
});

test("unl-199-219 Deceiver: 'Give it [Temporary]' is declared as a keyword grant over the created token", () => {
  for (const [temporary, prefix] of [
    [conquerTemporary, "deceiver.conquer"],
    [holdTemporary, "deceiver.hold"]
  ]) {
    // 816.1: Temporary is a triggered-ability keyword; the grant is recorded for
    // the merged keyword registry and still needs production trigger binding.
    assert.equal(temporary.op, "continuous.grant-keyword");
    assert.deepEqual(temporary.args.keyword, {
      kind: "constant",
      value: "Temporary"
    });
    assert.deepEqual(temporary.args.duration, {
      kind: "constant",
      value: "permanent"
    });
    assert.deepEqual(temporary.targets, [
      {
        id: prefix + "-created-unit",
        filter: {
          type: "unit",
          object: { linked: prefix + "-play-token" }
        },
        min: 1,
        max: 1,
        selection: "one"
      }
    ]);
    assert.equal(temporary.linkedTo, prefix + "-play-token");
  }
});

test("unl-199-219 Deceiver: the merged Temporary definition is available for the declared grant", () => {
  assert.equal(keywordDefinitionsById.has("Temporary"), true);
});

test("unl-199-219 Deceiver: declining either optional body performs no payment or token action", () => {
  // This is the resolution-level optional wrapper only; the trigger's
  // Finalize decision and upfront base payment remain separate blockers.
  for (const ability of [conquer, hold]) {
    const kernel = world()
      .unit("deceiver", { types: ["legend"], might: null, exhausted: false })
      .hand("retained-card")
      .build();
    const context = kernel.clone({ sourceSnapshot: kernel.getObject("deceiver") });
    context.setAnswers({ [`${ability.body[0].id}/optional`]: false });
    const before = context.snapshot();
    const result = resolveChainBody(ability.body, context);
    assert.deepEqual(result.results.map(entry => [entry.id, entry.result.status, entry.result.reason]), [
      [ability.body[0].id, "negated", "skipped"]
    ]);
    assert.deepEqual(result.events, []);
    assert.deepEqual(context.events, []);
    assert.equal(context.getObject("deceiver").exhausted, false);
    assert.equal(context.getObject("retained-card").zone, "hand");
    assert.equal(context.query({ type: "unit", zone: "board" }).length, 0);
    assert.deepEqual(context.snapshot(), before);
  }
});

test.todo(
  "unl-199-219 Deceiver: pay 'discard 1 and exhaust me' as the trigger's base cost at Finalize " +
    "(CR 383.3.b / 204.3 / 415.4-415.5) — TriggeredAbility has no base-cost slot and the production Finalize adapter does not consume the nested payment"
);
test.todo(
  "unl-199-219 Deceiver: chain-create then cost-waived play of the Reflection token with the 'ready' entry " +
    "override (CR 440.2.c / 185.2.a / 350.2 / 354 / 143.4 / 184.1) — effect.token still has no entry-state override"
);
test.todo(
  "unl-199-219 Deceiver: 'It becomes a copy of another unit there' through the copy layer (CR 446.1-446.2) — " +
    "effect.copy's \"effect\" mode remains blocked by copy-layer-traits-exceptions-and-attachment-duration-unavailable"
);
test.todo(
  "unl-199-219 Deceiver: bind 'there' from the conquer / hold details.battlefieldId — IR has no event battlefield selector for token destination and same-location target selection"
);
test("unl-199-219 Deceiver: the trigger filter now passes assertTriggerSpec, but the body anchor blocks registration", () => {
  // 383.4.c.2.b / 383.4.d.2.b: the shipped event vocabulary is "conquered"/"held"
  // (TriggerSpec EVENT_PATTERN_TYPES; pipeline-match EVENT_NAMES) and the
  // translated trigger filters really do pass validation. The registration
  // still fails closed one step later: the body's continuous.grant-keyword
  // target filter uses `object: { linked: … }`, which
  // programs/filters.ts translateObjectFilter rejects.
  const binding = createProgramBinding({
    cardPrograms: [{ ...program, status: "executable", judgeReason: undefined }]
  });
  const f = fixture({ cards: [{ id: "deceiver", cardId: CANONICAL_ID, types: ["legend"] }] });
  f.engine.commit({
    type: "move-zone",
    object: f.kernel.ref("deceiver"),
    to: "battlefield",
    location: { type: "battlefield", id: "battlefield-1" }
  });
  f.engine.advance();
  const source = f.kernel.getObject("deceiver");

  // The fixed trigger filters are accepted by the production translator.
  assert.deepEqual(
    program.abilities.map((ability) =>
      translateTriggerFilter(ability.trigger.filter, source.ref.id, ability.trigger.at)
    ),
    [
      { event: "conquered", player: "self" },
      { event: "held", player: "self" }
    ]
  );
  // Both bodies still fail their target-filter translation, so neither
  // trigger reaches the pipeline. Fail closed — not an approximation.
  for (const ability of program.abilities) {
    assert.throws(
      () => translateInstructionTargets(ability.body),
      (error) => error.name === "ProgramBindingError" && /Unsupported filter field object/.test(error.message)
    );
  }
  assert.throws(
    () => triggerRegistrations(binding.registry, source),
    (error) => error.name === "ProgramBindingError" && /Unsupported filter field object/.test(error.message)
  );
  assert.throws(
    () => binding.registerProgramTriggers(f.engine, source),
    (error) => error.name === "ProgramBindingError" && /Unsupported filter field object/.test(error.message)
  );
});

test.todo(
  "unl-199-219 Deceiver: give the created token [Temporary] so the granted keyword really registers a " +
    "beginning-start kill (CR 816.1) — continuous.grant-keyword only writes the ability layer, so a keyword " +
    "granted during resolution never becomes a registered beginning-start trigger"
);
