// Scenario execution evidence: ../templates/static-replacement-effect-ready-663.test.mjs (blocked full-card candidates).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/crescent-guardian.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { evaluateCondition } from "../../../../engine-core/dist/effects/interpreter/condition.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
// The replacement binding is the merged path this card's entry replacement now
// reaches; the golden below proves the merge and its limit.
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { fixture, resolveAll } from "../../../../engine-core/test/chain/helpers.mjs";
import { translateCost } from "../../../../engine-core/dist/programs/play.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/statics.js";

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
  assert.match(program.judgeReason, /replacement\/bind\.ts/);
  assert.match(program.judgeReason, /359\.2\.c/);
  assert.match(program.judgeReason, /805\.6\.a/);
  // Re-probed 2026-10-17: the replacement body executes, but the static
  // cost.additional has no binding path and the entry matcher ignores conditions.
  assert.match(program.judgeReason, /cost\.additional/);
  assert.match(program.judgeReason, /layerFor/);
  assert.match(program.judgeReason, /condition\.result/);
  assert.ok(!/RIFT-89/.test(program.judgeReason));
});

test("unl-122-219 Crescent Guardian: the printed power is null, and the extra cost is one Chaos Power", () => {
  // energy: null / power: null mean “no printed value” and are never rewritten as
  // 0; the optional additional cost is a separate component (204.2, 356.2.b.1).
  assert.equal(program.abilities.length, 2);
  assert.equal(additionalCost.kind, "static");
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.equal(additionalCost.effect.id, "crescent-guardian.additional-cost");
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
  // history count is available through condition.history, but not in a static
  // Condition expression; the named result is unavailable until the static history consumer is connected.
  assert.deepEqual(additionalCost.condition, {
    kind: "result",
    result: "crescent-guardian.spell-history",
    key: "count",
    operator: "gte",
    right: { kind: "constant", value: 1 }
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
    kind: "result",
    result: "cost.additional",
    id: "crescent-guardian.additional-cost"
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

test("unl-122-219 Crescent Guardian boundary: the static cost.additional has no production binder (CR 356.2.b/356.2.b.1)", () => {
  // Re-probed 2026-10-17: the planner already pays a caller-supplied optional
  // component (meditation/frostcoat-cub precedent), but no merged path derives it
  // from this card's static declaration. programs/play.ts::translateCost only
  // accepts printed/activated/explicit kinds, and the production static binder
  // has no layer for cost.additional, so Finalize never charges the 1 Chaos Power
  // and never produces the paid/declined receipt the entry rewrite has to read.
  assert.equal(additionalCost.effect.kind, "cost.additional");
  assert.throws(
    () => translateCost(additionalCost.effect, "crescent-guardian", "play"),
    (error) => error.code === "judge-required" && /Unsupported play cost field/.test(error.message)
  );
  const board = fixture({
    cards: [{ id: "guardian", cardId: program.canonicalCardId, types: ["unit"], energy: 4, power: [], might: 4 }]
  });
  assert.throws(
    () => createEngineStaticBinder(board.engine).bindStatic(additionalCost, board.kernel.getObject("guardian")),
    (error) => error.code === "judge-required" && /cost\.additional/.test(error.message) && /no layer mapping/.test(error.message)
  );
});
test("unl-122-219 Crescent Guardian golden: the supported entry-replacement fragment enters ready (369.3)", () => {
  // bindReplacement accepts the
  // declared shape (a single self-targeted effect.ready on object-enters-board)
  // as an entry declaration, and a real play of the card lands it ready instead
  // of the 359.2.c exhausted entry.
  // Bind only the supported entry declaration, without the unresolved payment gate.
  const board = fixture({
    cards: [{ id: "guardian", cardId: program.canonicalCardId, types: ["unit"], energy: 4, power: [], might: 4 }]
  });
  const host = board.kernel.getObject("guardian");
  const bound = bindReplacement(
    { replaces: enterReady.replaces, with: enterReady.with },
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
  board.engine.execute(board.card("guardian", {
    kind: "unit",
    body: [],
    location: { type: "battlefield", id: "bf-1" }
  }));
  resolveAll(board.engine);

  const snapshot = board.kernel.getObject("guardian");
  assert.equal(snapshot.zone, "board");
  assert.equal(board.kernel.player("A").energy, 16);
  // 359.2.c would enter exhausted; the entry declaration replaces that with a
  // ready entry without a separate becomes-ready timing (805.6.a).
  assert.equal(snapshot.exhausted, false);
  assert.equal(
    board.engine.pipeline.events.some((event) => event.timingPoint === "object-readied" && event.source?.ref.id === host.ref.id),
    false
  );
});

test("unl-122-219 Crescent Guardian boundary: a never condition must preserve exhausted entry (CR 356.4.f.1)", { todo: "RIFT-260: entry matcher returns before testCondition" }, () => {
  // Re-probed 2026-10-17: replacement/bind.ts matchesEnterAction() returns true
  // before testCondition() runs. Binding the entry declaration with a `never`
  // condition still readies the entering unit in the real pipeline, which is the
  // regression for this card's "If you do" gate. The
  // authored condition is asserted separately so it stays reviewable.
  assert.deepEqual(enterReady.condition, {
    kind: "result",
    result: "cost.additional",
    id: "crescent-guardian.additional-cost"
  });
  const board = fixture({
    cards: [{ id: "guardian", cardId: program.canonicalCardId, types: ["unit"], energy: 4, power: [], might: 4 }]
  });
  const host = board.kernel.getObject("guardian");
  const bound = bindReplacement(
    { replaces: enterReady.replaces, with: enterReady.with, condition: { kind: "never" } },
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
  assert.equal(bound.registration.id, "replacement:" + host.ref.id + ":" + host.ref.zoneEntryId);
  // CR 364.3.a: an inactive replacement must leave the default exhausted entry.
  board.engine.execute(board.card("guardian", {
    kind: "unit",
    body: [],
    location: { type: "battlefield", id: "bf-1" }
  }));
  resolveAll(board.engine);
  assert.equal(board.kernel.getObject("guardian").zone, "board");
  assert.equal(board.kernel.getObject("guardian").exhausted, true);
  bound.cancel();
});

test("unl-122-219 Crescent Guardian boundary: the spell-history applicability has no static-cost consumer", () => {
  // condition.history really counts committed play actions by type (next golden),
  // but the static cost applicability is a condition on a static ability, and no
  // merged consumer maps history reads into cost applicability. The authored
  // condition declares a missing result dependency, so this test
  // pins both halves: the working history primitive and the missing adapter.
  assert.deepEqual(additionalCost.condition, {
    kind: "result",
    result: "crescent-guardian.spell-history",
    key: "count",
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  const kernel = world().player("A").hand("spell", { types: ["spell"], owner: "A" }).build();
  const counted = resolveChainBody([{
    id: "spell-count",
    op: "condition.history",
    args: { query: { kind: "constant", value: { scope: "turn", action: "play", player: "A", objectFilter: { type: "spell" } } } }
  }], kernel).linkedValues["spell-count.count"];
  assert.equal(counted, 0);
  // A missing static history result must not become a truthy string. The body
  // history instruction above does not publish this declared result dependency.
  assert.throws(() => evaluateCondition(additionalCost.condition, {
    context: kernel,
    linked: key => kernel.linked(key),
    canLookBack: () => true,
    isIgnored: () => false
  }), /Unavailable condition result: crescent-guardian\.spell-history/);
});


test("unl-122-219 Crescent Guardian golden: condition.history distinguishes committed spells by their player and type", () => {
  const kernel = world()
    .hand("own-spell", { types: ["spell"], owner: "A" })
    .hand("own-unit", { types: ["unit"], owner: "A" })
    .hand("enemy-spell", { types: ["spell"], owner: "B" })
    .build();
  const countSpells = () => resolveChainBody([{
    id: "played-spells",
    op: "condition.history",
    args: {
      query: { kind: "constant", value: { scope: "turn", action: "play", player: "A", objectFilter: { type: "spell" } } }
    }
  }], kernel).linkedValues["played-spells.count"];
  assert.equal(countSpells(), 0);
  for (const [id, player] of [["own-unit", "A"], ["enemy-spell", "B"]]) {
    assert.equal(kernel.perform({ type: "play", object: kernel.ref(id), player }).status, "done");
  }
  assert.equal(countSpells(), 0);
  assert.equal(kernel.perform({ type: "play", object: kernel.ref("own-spell"), player: "A" }).status, "done");
  assert.equal(countSpells(), 1);
  assert.deepEqual(kernel.events.map(event => event.action), ["play", "play", "play"]);
});
