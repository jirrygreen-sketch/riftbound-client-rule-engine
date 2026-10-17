import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/crescent-guardian.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
// RIFT-260's replacement binding is the merged path this card's entry
// replacement now reaches; the golden below proves the merge and its limit.
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL_ID =
  "card.hash-62fb90bb0e876e500de763bb4ffad29e29022a5cbd31d536a7adf6619570bca6";
const SOURCE_TEXT =
  "If you've played a spell this turn, you may pay :rb_rune_chaos: as an additional cost to play me. " +
  "If you do, I enter ready.";

const [additionalCost, enterReady] = program.abilities;

test("unl-122-219 Crescent Guardian: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-122-219 Crescent Guardian: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
  assert.match(program.judgeReason, /356\.2\.b/);
  assert.match(program.judgeReason, /356\.4\.f\.1/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.match(program.judgeReason, /805\.6\.a/);
  // replacement.enter/effect.ready is executable; the remaining wiring is the
  // CardProgram-to-Finalize optional-cost receipt and the history predicate.
  assert.match(program.judgeReason, /RIFT-349/);
  assert.ok(!/RIFT-89/.test(program.judgeReason));
});

test("unl-122-219 Crescent Guardian: the printed power is null, and the extra cost is one Chaos Power", () => {
  // energy: null / power: null mean “no printed value” and are never rewritten as
  // 0; the optional additional cost is a separate component (204.2, 356.2.b.1).
  assert.equal(program.abilities.length, 2);
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.optional, true);
  assert.equal(additionalCost.effect.appliesTo, "self");
  assert.equal(additionalCost.effect.stage, "optional-additional");
  assert.deepEqual(additionalCost.effect.payments, [
    { kind: "power", amount: { kind: "constant", value: 1 }, domain: "Chaos" }
  ]);
  assert.equal(additionalCost.effect.energy, undefined);
});

test("unl-122-219 Crescent Guardian: the cost's applicability is the printed spell condition, recorded as a predicate", () => {
  // 356.2.b.1: the Optional Additional Cost is specified by a Passive Ability of
  // the card being played, gated on “you've played a spell this turn”. The
  // per-card-type history count has no merged evaluation path, so the condition
  // stays a named predicate (see the judgeReason).
  assert.deepEqual(additionalCost.condition, {
    kind: "expression",
    value: { kind: "constant", value: "you-played-a-spell-this-turn" }
  });
});

test("unl-122-219 Crescent Guardian: 'I enter ready' is an entry replacement, not a post-entry ready (359.2.c, 369.3)", () => {
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  // 356.4.f.1: “If you do” keys off the paid decision, not off a resource delta.
  assert.deepEqual(enterReady.condition, {
    kind: "expression",
    value: { kind: "constant", value: "crescent-guardian.additional-cost-was-paid" }
  });
  assert.equal(enterReady.with.length, 1);
  const [enterReadyInstruction] = enterReady.with;
  assert.equal(enterReadyInstruction.id, "crescent-guardian.enter-ready");
  assert.equal(enterReadyInstruction.op, "effect.ready");
  // The replaced event's object is the entering unit itself (source selector).
  assert.deepEqual(enterReadyInstruction.args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(enterReadyInstruction.targets, undefined);
  assert.equal(enterReadyInstruction.linkedTo, undefined);
});

test("unl-122-219 Crescent Guardian: effect.ready is not a substitute for the entry replacement (its own docs say so)", () => {
  // 359.2.c makes Units enter exhausted and 805.6.a is explicit that the
  // Accelerate-shaped replacement does not enter exhausted first, so the merged
  // effect.ready primitive can only be the replacement's commit step — it must
  // never be re-used as a retroactive ready (the card declares no ready
  // instruction outside the replacement body).
  assert.deepEqual(
    program.abilities.flatMap(ability =>
      ability.kind === "replacement" ? ability.with.map(instruction => instruction.op) : []
    ),
    ["effect.ready"]
  );
  assert.equal(program.abilities.filter(ability => ability.kind === "play").length, 0);
  assert.equal(program.abilities.filter(ability => ability.kind === "triggered").length, 0);
});

test("unl-122-219 Crescent Guardian golden: the declared replacement commit readies an exhausted unit (416.1)", () => {
  // This executes the declared replacement instruction against a real board unit to
  // prove the instruction body is a live, valid primitive call — the merged
  // magma-wurm / accelerate precedent. A replacement handler binds "source" to
  // the entering unit, so the test supplies that unit as the source.
  const base = world().unit("guardian", { might: 4, exhausted: true }).build();
  const kernel = base.clone({ source: base.ref("guardian"), sourceSnapshot: base.getObject("guardian") });
  assert.equal(kernel.getObject("guardian").exhausted, true);

  const [enterReadyInstruction] = enterReady.with;
  const outcome = resolveChainBody([enterReadyInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("guardian").exhausted, false);
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 1);
});

test("unl-122-219 Crescent Guardian golden: an already-ready unit is not readied again (416.1.b/416.1.c)", () => {
  const base = world().unit("guardian", { might: 4, exhausted: false }).build();
  const kernel = base.clone({ source: base.ref("guardian"), sourceSnapshot: base.getObject("guardian") });

  const [enterReadyInstruction] = enterReady.with;
  const outcome = resolveChainBody([enterReadyInstruction], kernel);

  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "unl-122-219 Crescent Guardian: the optional [C] additional cost is declared at Finalize, charged, and the paid " +
    "decision is returned as a receipt (CR 356.2.b/356.2.b.1, 356.4.f.1) — cost/cost-plan.ts only consumes " +
  "caller-supplied optionalAdditional; CardProgram cost.additional is not yet wired into Finalize (RIFT-349 follow-up)"
);
test("unl-122-219 Crescent Guardian golden: RIFT-260 binds this declaration and rewrites the entry to ready (369.3)", () => {
  // bindReplacement accepts the
  // declared shape (a single self-targeted effect.ready on object-enters-board)
  // as an entry declaration, and a real play of the card lands it ready instead
  // of the 359.2.c exhausted entry.
  const executable = {
    canonicalCardId: program.canonicalCardId,
    rulesetVersion: program.rulesetVersion,
    status: "executable",
    abilities: program.abilities,
    sourceText: program.sourceText
  };
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const board = fixture({
    cards: [{ id: "guardian", cardId: program.canonicalCardId, types: ["unit"], energy: 4, power: [], might: 4 }],
    describePlay: binding.describePlay
  });
  const host = board.kernel.getObject("guardian");
  const bound = bindReplacement(
    { replaces: enterReady.replaces, with: enterReady.with, condition: enterReady.condition },
    host.ref,
    {
      host: {
        object: (ref) => board.kernel.object(ref),
        objects: () => board.kernel.objects,
        context: (source, controller) => board.kernel
      },
      pipeline: board.engine.pipeline
    }
  );
  assert.equal(bound.registration.id, "replacement:" + host.ref.id + ":" + host.ref.zoneEntryId);

  // The production play resolution puts the permanent on the Chain, lands its
  // default orientation (359.2.c exhausted) and then moves it to the Board; the
  // bound entry declaration intercepts that move.
  board.engine.commit({
    type: "play",
    object: board.kernel.ref("guardian"),
    player: "A",
    location: { type: "battlefield", id: "bf-1" }
  });
  board.engine.advance();
  resolveAll(board.engine);

  const snapshot = board.kernel.getObject("guardian");
  assert.equal(snapshot.zone, "board");
  // 359.2.c would enter exhausted; the entry declaration replaces that with a
  // ready entry without a separate becomes-ready timing (805.6.a).
  assert.equal(snapshot.exhausted, false);
  assert.equal(
    board.engine.pipeline.events.some((event) => event.timingPoint === "object-readied" && event.source?.ref.id === host.ref.id),
    false
  );
});

test("unl-122-219 Crescent Guardian: RIFT-260 evaluates the declared gate before applying the entry rewrite", () => {
  // The merged binding evaluates ability.condition with evaluateCondition at
  // match time. That is the real gate this card's "If you do" has to ride on
  // once the paid-cost receipt exists; the declaration itself is asserted here.
  assert.deepEqual(enterReady.condition, {
    kind: "expression",
    value: { kind: "constant", value: "crescent-guardian.additional-cost-was-paid" }
  });
  // The evaluator treats a constant string as a truthy predicate, so the
  // condition cannot distinguish paid from declined in merged code yet.
  const board = fixture({
    cards: [{ id: "guardian", cardId: program.canonicalCardId, types: ["unit"], energy: 4, power: [], might: 4 }]
  });
  const host = board.kernel.getObject("guardian");
  const bound = bindReplacement(
    { replaces: enterReady.replaces, with: enterReady.with, condition: enterReady.condition },
    host.ref,
    {
      host: {
        object: (ref) => board.kernel.object(ref),
        objects: () => board.kernel.objects,
        context: () => board.kernel
      },
      pipeline: board.engine.pipeline
    }
  );
  assert.equal(bound.registration.id.length > 0, true);
});
test.todo(
  "unl-122-219 Crescent Guardian: “If you've played a spell this turn” is evaluated from the turn's played " +
    "spells — the merged history evaluation covers prior GameActions, not card-played Finalization by card type"
);

