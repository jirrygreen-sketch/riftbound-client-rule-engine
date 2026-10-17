import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/trifarian-gloryseeker.js";
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { runAbilityBody } = await import(new URL("effects/interpreter.js", engineCore));
const { evaluateExpression } = await import(new URL("effects/interpreter/expr.js", engineCore));
const { historyCount } = await import(new URL("effects/interpreter/history.js", engineCore));
const { bindResolveContext } = await import(new URL("events/action-adapter.js", engineCore));
const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");
const { registerProgramTriggers } = await import(new URL("programs/triggers.js", engineCore));
const { createEngineStaticBinder } = await import(new URL("programs/statics.js", engineCore));
const { ProgramRegistry } = await import(new URL("programs/registry.js", engineCore));
const { expandProgram } = await import(new URL("programs/keywords.js", engineCore));

const BUFF_ID = "trifarian-gloryseeker.buff-me";

const bodyForExecution = () => program.abilities[1].body;

test("ogn-217-298 Trifarian Gloryseeker: program validates and has expected identity", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(
    program.canonicalCardId,
    "card.hash-0e5542d49264324b5497b244de3b3ad36381c763af055108066e1b17f7fb2aa7"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Legion/);
  assert.match(program.judgeReason, /effect\.buff/);
  assert.match(program.judgeReason, /condition\.history/);
  // Re-probed 2026-10-17: the gap is named by the concrete consumers that
  // refuse the shape, not by a historical task number.
  assert.match(program.judgeReason, /cards-finalized-this-turn/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.equal(/RIFT-359/.test(program.judgeReason), false);
  assert.equal(
    program.sourceText,
    "[Legion] — When you play me, buff me. (If I don't have a buff, I get a +1 :rb_might: buff. " +
      "Get the effect if you've played another card this turn.)"
  );
});

test("ogn-217-298 Trifarian Gloryseeker: Legion keyword plus the gated card-played buff", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.equal(keyword.kind, "keyword");
  assert.equal(keyword.keyword, "legion");
  assert.equal(keyword.value, undefined);

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, { event: "card-played", filter: { source: "self" } });
  // CR 812.1.b.1 / 812.1.c: the dependent ability is active only when another,
  // different card has been finalized by you this turn.
  assert.equal(triggered.trigger.condition.kind, "compare");
  assert.equal(triggered.trigger.condition.operator, "gte");
  assert.deepEqual(triggered.trigger.condition.right, { kind: "constant", value: 1 });
  assert.equal(triggered.trigger.condition.left.kind, "count");
  assert.equal(triggered.trigger.condition.left.subject, "cards-finalized-this-turn");
  assert.deepEqual(triggered.trigger.condition.left.filter, {
    player: "controller",
    exclude: "self"
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.trigger.once, undefined);

  assert.equal(triggered.body.length, 1);
  const [buff] = triggered.body;
  assert.equal(buff.id, BUFF_ID);
  assert.equal(buff.op, "effect.buff");
  assert.deepEqual(buff.args.mode, { kind: "constant", value: "buff" });
  assert.deepEqual(buff.args.target, { kind: "constant", value: "self-unit" });
  assert.deepEqual(buff.targets[0].filter, {
    object: "self",
    type: "unit",
    zone: "board"
  });
  assert.equal(buff.targets[0].min, 1);
  assert.equal(buff.targets[0].max, 1);
  assert.equal(buff.targets[0].selection, "one");
  assert.equal(buff.linkedTo, undefined);
  assert.equal(buff.condition, undefined);
});

test("ogn-217-298 Trifarian Gloryseeker golden: 'buff me' places one Buff on the source", () => {
  const base = world()
    .unit("gloryseeker", { might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("gloryseeker") });
  kernel.setTargets("self-unit", [kernel.ref("gloryseeker")]);

  const outcome = runAbilityBody(bodyForExecution(), kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  // 702.2.a / 703: the Buff contributes +1 Might while it remains on the unit.
  assert.equal(kernel.getObject("gloryseeker").buffs, 1);
  assert.deepEqual(outcome.results[0].result.linkedValues.buffed, [
    { id: "gloryseeker", zoneEntryId: 1 }
  ]);
});

test("ogn-217-298 Trifarian Gloryseeker: a unit that already has a Buff is not Buffed again (CR 702.3.a)", () => {
  const base = world()
    .unit("gloryseeker", {
      might: 2,
      buffs: 1,
      location: { type: "battlefield", id: "battlefield-1" }
    })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("gloryseeker") });
  kernel.setTargets("self-unit", [kernel.ref("gloryseeker")]);

  const outcome = runAbilityBody(bodyForExecution(), kernel);
  // 427.1.c: the unit is still a legal choice for a Buff action; it simply does
  // not receive a second counter.
  assert.equal(outcome.results[0].result.status, "negated");
  assert.equal(outcome.results[0].result.reason, "skipped");
  assert.equal(kernel.getObject("gloryseeker").buffs, 1);
});

test("Trifarian Gloryseeker: the merged keyword expansion declares the Legion history predicate", async () => {
  const { expandProgram, translateTriggerFilter } = await import("../../../../engine-core/dist/programs/index.js");
  const kernel = world().unit("gloryseeker", { cardId: program.canonicalCardId }).build();
  const expanded = expandProgram(program, kernel.getObject("gloryseeker"));
  assert.equal(expanded.expanded.length, 1);
  assert.equal(expanded.expanded[0].effect.kind, "condition.predicate");
  assert.equal(expanded.expanded[0].effect.history.scope, "turn");
  assert.equal(expanded.expanded[0].effect.history.action, "play");
  assert.deepEqual(translateTriggerFilter(program.abilities[1].trigger.filter, "gloryseeker", "card-played"), {
    event: "card-played", object: { objectId: "gloryseeker" }
  });
});

test("Trifarian Gloryseeker: contract history excludes this object but counts another copy of the same card", () => {
  const base = world()
    .hand("gloryseeker", { cardId: program.canonicalCardId, types: ["unit"], energy: null, power: null })
    .hand("another-gloryseeker", { cardId: program.canonicalCardId, types: ["unit"], energy: null, power: null })
    .build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("gloryseeker") });
  // Exercise the supported history instruction, not the still-unbound Legion
  // static predicate. "Another card" distinguishes objects, not card identities.
  const history = [{
    id: "legion-history",
    op: "condition.history",
    args: { query: { kind: "constant", value: {
      scope: "turn", action: "play", player: kernel.controller, exclude: "self"
    } } }
  }];
  assert.equal(kernel.perform({ type: "play", object: kernel.ref("gloryseeker"), player: kernel.controller }).status, "done");
  assert.equal(runAbilityBody(history, kernel).linkedValues["legion-history.count"], 0);

  assert.equal(kernel.perform({ type: "play", object: kernel.ref("another-gloryseeker"), player: kernel.controller }).status, "done");
  const outcome = runAbilityBody(history, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["legion-history.count"], 1);
  assert.equal(kernel.getObject("gloryseeker").cardId, kernel.getObject("another-gloryseeker").cardId);

  assert.equal(kernel.perform({ type: "return-to-hand", object: kernel.ref("gloryseeker") }).status, "done");
  assert.equal(kernel.perform({ type: "play", object: kernel.ref("gloryseeker"), player: kernel.controller }).status, "done");
  assert.equal(runAbilityBody(history, kernel).linkedValues["legion-history.count"], 1);
});

test("Trifarian Gloryseeker boundary: the authored Legion condition counts live objects, not this turn's plays (CR 812.1.b.1 / 812.1.c)", () => {
  // Re-probed 2026-10-17: the count expression ignores its subject and only
  // counts objects passing the (partly unknown) filter, so the gate is satisfied
  // by an empty board and grows with any object, play history or not.
  const condition = program.abilities[1].trigger.condition;
  assert.equal(condition.left.subject, "cards-finalized-this-turn");

  const empty = fixture({ cards: [] });
  const emptyContext = bindResolveContext(empty.kernel, { host: empty.kernel.ref("source") });
  const emptyCount = evaluateExpression(condition.left, {
    context: emptyContext, host: empty.kernel.ref("source"), linked: () => undefined,
    canLookBack: () => true, isIgnored: () => false, query: filter => empty.kernel.query(filter)
  });

  const busy = fixture({ cards: Array.from({ length: 7 }, (_, index) => ({ id: `u${index}`, owner: "A", controller: "A", types: ["unit"], might: 1 })) });
  for (let index = 0; index < 7; index += 1) {
    busy.engine.commit({ type: "move-zone", object: busy.kernel.ref(`u${index}`), to: "board", location: { type: "base", player: "A" } });
  }
  const busyContext = bindResolveContext(busy.kernel, { host: busy.kernel.ref("source") });
  const busyCount = evaluateExpression(condition.left, {
    context: busyContext, host: busy.kernel.ref("source"), linked: () => undefined,
    canLookBack: () => true, isIgnored: () => false, query: filter => busy.kernel.query(filter)
  });

  // Zero plays happened in either world, yet the counts differ and both clear the
  // gte 1 threshold: the subject field participates in nothing.
  assert.notEqual(emptyCount, busyCount);
  assert.ok(emptyCount >= 1 && busyCount >= 1);
});

test("Trifarian Gloryseeker boundary: the trigger body's object:'self' target is refused by the production filter translator (CR 355.10.d.1)", () => {
  // Re-probed 2026-10-17: the authored target's object:'self' anchor survives
  // validation but the production translator that registerProgramTriggers uses
  // rejects it, so the dependent ability cannot be registered at all.
  const f = fixture({ cards: [{ id: "gloryseeker", cardId: program.canonicalCardId, types: ["unit"], energy: 1, power: ["Fury"], might: 2 }] });
  const registry = new ProgramRegistry([{ ...program, status: "executable", judgeReason: undefined }]);
  assert.throws(
    () => registerProgramTriggers(registry, f.engine, f.kernel.getObject("gloryseeker")),
    (error) => error.code === "judge-required" && /Unsupported filter field object/.test(error.message)
  );
  assert.equal(f.engine.pipeline.checkpoint().triggers.size, 0);
});

test("Trifarian Gloryseeker boundary: the Legion predicate is unbound and its history payload is rejected (CR 812.1.c)", () => {
  // Re-probed 2026-10-17: the expansion declares condition.predicate, which the
  // production static binder has no layer for, and the payload's
  // history.excluding spelling is refused by the interpreter's own history
  // field whitelist. No path therefore derives "another card finalized this
  // turn" for the dependent ability.
  const kernel = world().unit("gloryseeker", { cardId: program.canonicalCardId }).build();
  const expanded = expandProgram(program, kernel.getObject("gloryseeker"));
  assert.deepEqual(expanded.expanded.map(ability => ability.effect.kind), ["condition.predicate"]);
  assert.equal(expanded.expanded[0].effect.history.excluding, program.canonicalCardId);

  const f = fixture({ cards: [{ id: "gloryseeker", cardId: program.canonicalCardId, types: ["unit"], energy: 1, power: ["Fury"], might: 2 }] });
  assert.throws(
    () => createEngineStaticBinder(f.engine).bindStatic(expanded.expanded[0], f.kernel.getObject("gloryseeker")),
    (error) => error.code === "judge-required" && /condition\.predicate/.test(error.message) && /no layer mapping/.test(error.message)
  );
  assert.deepEqual(f.engine.layers.registry.list(), []);

  const context = bindResolveContext(world().player("A").player("B").build(), {});
  assert.throws(
    () => historyCount({ scope: "turn", action: "play", player: "controller", excluding: program.canonicalCardId }, context),
    /Unsupported history query field/
  );
});

test("Trifarian Gloryseeker boundary: effect.buff still requires a TargetSpec id, so 'buff me' has no non-target form (CR 355.10.d.1 / 702.2.a)", async () => {
  // Re-probed 2026-10-17: the primitive's argument schema insists on a non-empty
  // TargetSpec id string; there is no self/selector spelling, which is exactly
  // why the retained self-unit TargetSpec is blocked authoring data rather than
  // an executable path.
  const [buff] = program.abilities[1].body;
  assert.deepEqual(buff.args.target, { kind: "constant", value: "self-unit" });
  assert.deepEqual(buff.targets[0].filter, { object: "self", type: "unit", zone: "board" });
  const { default: effectBuff } = await import(new URL("effects/instructions/effect.buff.js", engineCore));
  assert.throws(() => effectBuff.argsSchema.parse({ mode: "buff" }), /target must be a non-empty TargetSpec id/);
  assert.throws(() => effectBuff.argsSchema.parse({ mode: "buff", target: { kind: "constant", value: "self-unit" } }), /target must be a non-empty TargetSpec id/);
});
