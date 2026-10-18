import assert from "node:assert/strict";
import test from "node:test";

import { AwaitChoice } from "../../dist/effects/contract.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { world } from "../../dist/effects/testing/index.js";
import { createProgramBinding } from "../../dist/programs/index.js";
import { fixture, settle } from "../rules/keywords/support.mjs";
import albusFerros from "../../../card-dsl/dist/cards/ogn/albus-ferros.js";
import overtOperation from "../../../card-dsl/dist/cards/ogn/overt-operation.js";
import peakGuardian from "../../../card-dsl/dist/cards/ogn/peak-guardian.js";

const c = value => ({ kind: "constant", value });
const field = id => ({ type: "battlefield", id });
const triggered = program => program.abilities.find(ability => ability.kind === "triggered");
const playBody = program => program.abilities.find(ability => ability.kind === "play").body;
const sourceContext = (kernel, id = "host") => kernel.clone({ sourceSnapshot: kernel.getObject(id) });

function sourceProgram(id, body, extraAbilities = []) {
  return {
    canonicalCardId: `test:${id}`,
    rulesetVersion: "core-1.5",
    status: "executable",
    sourceText: id,
    abilities: [{ kind: "play", cost: { kind: "printed" }, body }, ...extraAbilities]
  };
}

test("EG-BUFF original Overt Operation query buffs every current friendly Unit without Finalize targets", () => {
  const program = sourceProgram("overt-query", [playBody(overtOperation).at(-1)]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.hand("spell", { cardId: program.canonicalCardId, types: ["spell"], energy: 0, power: [] });
      builder.unit("ally-a", { buffs: 0, energy: null, power: null });
      builder.unit("ally-b", { buffs: 1, energy: null, power: null });
      builder.unit("enemy", { owner: "B", controller: "B", energy: null, power: null });
    }
  });
  const body = playBody(program);
  assert.equal(body[0].targets, undefined);
  f.play("spell");
  settle(f.engine);
  assert.equal(f.get("ally-a").buffs, 1);
  assert.equal(f.get("ally-b").buffs, 1);
  assert.equal(f.get("enemy").buffs, 0);
  assert.equal(f.get("ally-a").energy, null);
  assert.equal(f.get("ally-a").power, null);
  assert.deepEqual(f.errors, []);
});

test("EG-BUFF direct host and linked refs use source/link selectors without a TargetSpec", () => {
  const body = [
    { id: "host-buff", op: "effect.buff", args: { mode: c("buff"), objects: c({ kind: "source" }) } },
    { id: "linked-spend", op: "effect.buff", args: { mode: c("spend"), objects: { kind: "linked-value", instructionId: "seed", key: "objects" } } }
  ];
  const kernel = world()
    .unit("host", { buffs: 1, energy: null, power: null })
    .unit("linked", { buffs: 1, energy: null, power: null })
    .build();
  kernel.link("seed.objects", [{ id: kernel.ref("linked").id, zoneEntryId: kernel.ref("linked").zoneEntryId }]);
  const context = sourceContext(kernel);
  const result = resolveChainBody(body, context);
  assert.equal(result.results[0].result.status, "negated");
  assert.equal(result.results[0].result.reason, "skipped");
  assert.equal(result.results[1].result.status, "executed");
  assert.equal(context.getObject("host").buffs, 1);
  assert.equal(context.getObject("linked").buffs, 0);
  assert.equal(result.linkedValues["linked-spend.spentCount"], 1);
  assert.equal(context.getObject("host").energy, null);
  assert.equal(context.getObject("host").power, null);
});

test("EG-BUFF original Albus Ferros pick spends any number at resolution and reports the actual count", () => {
  const ability = triggered(albusFerros);
  const program = sourceProgram("albus-production", [], [ability]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.hand("albus", { cardId: program.canonicalCardId, types: ["unit"], energy: 0, power: [] });
      builder.unit("buffed-a", { buffs: 1, energy: null, power: null });
      builder.unit("buffed-b", { buffs: 1, energy: null, power: null });
      builder.unit("unbuffed", { buffs: 0, energy: null, power: null });
      builder.unit("enemy", { owner: "B", controller: "B", buffs: 1, energy: null, power: null });
    }
  });
  f.answers.set(
    "albus-ferros.spend-buffs/pick%3Aalbus-ferros.buffs",
    [f.ref("buffed-a"), f.ref("buffed-b")]
  );
  f.play("albus");
  settle(f.engine);
  assert.equal(f.get("buffed-a").buffs, 0);
  assert.equal(f.get("buffed-b").buffs, 0);
  assert.equal(f.get("unbuffed").buffs, 0);
  assert.equal(f.get("enemy").buffs, 1);
  assert.equal(f.kernel.player("A").runePool.length, 2);
  assert.equal(f.errors.length, 0);
});

test("EG-BUFF original Albus Ferros production chain rolls back after an invalid pick", () => {
  const ability = triggered(albusFerros);
  const program = sourceProgram("albus-rollback", [], [ability]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.hand("albus", { cardId: program.canonicalCardId, types: ["unit"], energy: 0, power: [] });
      builder.unit("buffed-a", { buffs: 1, energy: null, power: null });
      builder.unit("buffed-b", { buffs: 1, energy: null, power: null });
    }
  });
  f.play("albus");
  const before = {
    state: f.kernel.stateForTest(),
    links: structuredClone(f.kernel.linkedSnapshot()),
    events: structuredClone(f.engine.pipeline.events),
    items: structuredClone(f.engine.items),
    trace: structuredClone(f.engine.trace),
    priority: f.engine.priority
  };
  f.answers.set("albus-ferros.spend-buffs/pick%3Aalbus-ferros.buffs", [
    { id: "forged", zoneEntryId: 1 }
  ]);
  assert.throws(() => settle(f.engine), /choice contains an unavailable or duplicate value/);
  assert.deepEqual(f.kernel.stateForTest(), before.state);
  assert.deepEqual(f.kernel.linkedSnapshot(), before.links);
  assert.deepEqual(f.engine.pipeline.events, before.events);
  assert.deepEqual(f.engine.items, before.items);
  assert.deepEqual(f.engine.trace.slice(0, before.trace.length), before.trace);
  assert.equal(
    f.engine.trace.slice(before.trace.length).some(entry => entry.step === "resolved" || entry.step === "removed"),
    false
  );
  assert.equal(f.get("buffed-a").buffs, 1);
  assert.equal(f.get("buffed-b").buffs, 1);
  assert.equal(f.kernel.player("A").runePool.length, 0);

  f.answers.set(
    "albus-ferros.spend-buffs/pick%3Aalbus-ferros.buffs",
    [f.ref("buffed-a"), f.ref("buffed-b")]
  );
  settle(f.engine);
  assert.equal(f.get("buffed-a").buffs, 0);
  assert.equal(f.get("buffed-b").buffs, 0);
  assert.equal(f.kernel.player("A").runePool.length, 2);
});

test("EG-BUFF arbitrary choose replays transactionally, accepts zero, and never targets the chosen Units", () => {
  const body = [{
    id: "choose-buffs",
    op: "effect.buff",
    args: {
      mode: c("spend"),
      objects: c({
        kind: "choose",
        id: "choose-buffs",
        filter: { type: "unit", zone: "board", controller: "self", buffed: true },
        min: 0,
        max: 99
      })
    }
  }];
  const kernel = world()
    .unit("a", { buffs: 1, energy: null, power: null })
    .unit("b", { buffs: 1, energy: null, power: null })
    .unit("plain", { energy: null, power: null })
    .build();
  const before = kernel.stateForTest();
  let request;
  assert.throws(() => resolveChainBody(body, sourceContext(kernel)), error => {
    assert.ok(error instanceof AwaitChoice);
    request = error.request;
    return true;
  });
  assert.deepEqual(request.options.map(ref => ref.id), ["a", "b"]);
  assert.equal(request.min, 0);
  assert.equal(request.max, 2);
  assert.deepEqual(kernel.stateForTest(), before);

  kernel.setAnswers({ "choose-buffs/choose-buffs": [kernel.ref("a"), kernel.ref("b")] });
  const context = sourceContext(kernel);
  const result = resolveChainBody(body, context);
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(result.linkedValues["choose-buffs.spentCount"], 2);
  assert.equal(context.getObject("a").buffs, 0);
  assert.equal(context.getObject("b").buffs, 0);
  assert.equal(context.events.filter(event => event.timingPoint === "became-target").length, 0);

  const zeroKernel = world().unit("a", { buffs: 1, energy: null, power: null }).build();
  zeroKernel.setAnswers({ "choose-buffs/choose-buffs": [] });
  const zeroContext = sourceContext(zeroKernel);
  const zero = resolveChainBody(body, zeroContext);
  assert.equal(zero.results[0].result.status, "executed");
  assert.equal(zeroContext.getObject("a").buffs, 1);
  assert.equal(zero.linkedValues["choose-buffs.spentCount"], 0);
});

test("EG-BUFF spend receipts count actual counters and enforce no-Buff/control legality", () => {
  const body = [{
    id: "spend",
    op: "effect.buff",
    args: { mode: c("spend"), target: c("buffs"), amount: c(5) }
  }];
  const kernel = world()
    .unit("two", { buffs: 2, energy: null, power: null })
    .unit("one", { buffs: 1, energy: null, power: null })
    .unit("empty", { buffs: 0, energy: null, power: null })
    .unit("enemy", { owner: "B", controller: "B", buffs: 1, energy: null, power: null })
    .build();
  kernel.setTargets("buffs", [kernel.ref("two"), kernel.ref("one"), kernel.ref("empty"), kernel.ref("enemy")]);
  const context = sourceContext(kernel);
  const result = resolveChainBody(body, context);
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(context.getObject("two").buffs, 0);
  assert.equal(context.getObject("one").buffs, 0);
  assert.equal(context.getObject("empty").buffs, 0);
  assert.equal(context.getObject("enemy").buffs, 1);
  assert.equal(result.linkedValues["spend.spentCount"], 3);
});

test("EG-BUFF buff caps every Unit at one even when amount is above one", () => {
  const body = [{
    id: "buff",
    op: "effect.buff",
    args: { mode: c("buff"), objects: c({ kind: "query", filter: { type: "unit", zone: "board", controller: "self" } }), amount: c(4) }
  }];
  const kernel = world().unit("a", { buffs: 0 }).unit("already", { buffs: 1 }).build();
  const context = sourceContext(kernel);
  const result = resolveChainBody(body, context);
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(context.getObject("a").buffs, 1);
  assert.equal(context.getObject("already").buffs, 1);
  assert.equal(result.linkedValues["buff.buffedCount"], 1);
});

test("EG-BUFF stale refs and rejected choices roll back without fabricated state", () => {
  const kernel = world().unit("gone", { buffs: 0 }).unit("live", { buffs: 1 }).build();
  const stale = kernel.ref("gone");
  kernel.perform({ type: "kill", object: stale });
  const staleResult = resolveChainBody([{
    id: "stale",
    op: "effect.buff",
    args: { mode: c("buff"), objects: c([stale]) }
  }], sourceContext(kernel));
  assert.equal(staleResult.results[0].result.status, "ignored");
  assert.equal(staleResult.results[0].result.reason, "mistargeted");

  const before = kernel.stateForTest();
  kernel.setAnswers({ "bad/bad": [{ id: "forged", zoneEntryId: 1 }] });
  assert.throws(() => resolveChainBody([{
    id: "bad",
    op: "effect.buff",
    args: { mode: c("spend"), objects: c({ kind: "choose", id: "bad", filter: { type: "unit", zone: "board" }, min: 0, max: 2 }) }
  }], sourceContext(kernel)), /Invalid effect\.buff choice answer/);
  assert.deepEqual(kernel.stateForTest(), before);
});

test("EG-BUFF forced non-target choices reject empty sets, forged refs and duplicate answers", () => {
  const body = [{
    id: "forced",
    op: "effect.buff",
    args: { mode: c("spend"), objects: c({ kind: "choose", id: "forced", filter: { type: "unit", zone: "board", buffed: true }, min: 1, max: 2 }) }
  }];
  const empty = world().unit("plain", { buffs: 0 }).build();
  const emptyContext = sourceContext(empty);
  const impossible = resolveChainBody(body, emptyContext);
  assert.deepEqual(impossible.results[0].result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(emptyContext.getObject("plain").buffs, 0);

  for (const answer of [
    [{ id: "forged", zoneEntryId: 1 }],
    [{ id: "a", zoneEntryId: -1 }],
    [{ id: "a", zoneEntryId: 1 }, { id: "a", zoneEntryId: 1 }]
  ]) {
    const kernel = world().unit("a", { buffs: 1 }).unit("b", { buffs: 1 }).build();
    kernel.setAnswers({ "forced/forced": answer });
    const before = kernel.stateForTest();
    assert.throws(() => resolveChainBody(body, sourceContext(kernel)), /Invalid effect\.buff choice answer/);
    assert.deepEqual(kernel.stateForTest(), before);
  }
});

test("EG-BUFF replacement rejection stops the primitive and preserves no partial receipt", () => {
  const body = [{
    id: "buff",
    op: "effect.buff",
    args: { mode: c("buff"), objects: c({ kind: "query", filter: { type: "unit", zone: "board", controller: "self" } }) }
  }];
  const kernel = world().unit("a").unit("b").build();
  kernel.addReplacement(action => action.type === "buff" ? "replaced" : null);
  const result = resolveChainBody(body, sourceContext(kernel));
  assert.equal(result.results[0].result.status, "negated");
  assert.equal(result.results[0].result.reason, "replaced");
  assert.equal(kernel.getObject("a").buffs, 0);
  assert.equal(kernel.getObject("b").buffs, 0);
});

test("EG-BUFF representative host IR keeps null costs while a source selector places one Buff", () => {
  const hostBody = [{
    id: "cithria.buff-self",
    op: "effect.buff",
    args: { mode: c("buff"), objects: c({ kind: "source" }) }
  }];
  const kernel = world().unit("cithria", { buffs: 0, energy: null, power: [] }).build();
  const context = sourceContext(kernel, "cithria");
  const result = resolveChainBody(hostBody, context);
  assert.equal(result.results[0].result.status, "executed");
  assert.equal(context.getObject("cithria").buffs, 1);
  assert.equal(context.getObject("cithria").energy, null);
  assert.deepEqual(context.getObject("cithria").power, []);
});

test("EG-BUFF original Peak Guardian self/other query shapes remain non-targeting at resolution", () => {
  const ability = triggered(peakGuardian);
  const program = sourceProgram("peak-shapes", ability.body);
  const binding = createProgramBinding({ cardPrograms: [program] });
  const kernel = world()
    .unit("peak", { cardId: program.canonicalCardId, location: field("one"), energy: null, power: null })
    .unit("ally", { location: field("one"), energy: null, power: null })
    .unit("elsewhere", { location: field("two"), energy: null, power: null })
    .build();
  const context = sourceContext(kernel, "peak");
  const sourceResult = resolveChainBody([ability.body[0]], context);
  assert.equal(sourceResult.results[0].result.status, "ignored");
  assert.equal(kernel.getObject("peak").energy, null);
  assert.equal(kernel.getObject("peak").power, null);
  assert.equal(binding.inspect(kernel.getObject("peak")).program, program);
});

test("EG-BUFF Peak Guardian other friendly units there resolve as a non-target production query", () => {
  const body = [{
    id: "peak-other-friendlies",
    op: "effect.buff",
    args: {
      mode: c("buff"),
      objects: c({
        kind: "query",
        filter: {
          type: "unit",
          zone: "board",
          controller: "controller",
          exclude: "self",
          sameLocationAs: "self"
        }
      })
    }
  }];
  const hostAbility = {
    kind: "triggered",
    trigger: {
      at: "card-played",
      filter: { event: "card-played", filter: { source: "self" } }
    },
    optional: false,
    body
  };
  const program = sourceProgram("peak-query", [], [hostAbility]);
  const f = fixture({
    programs: [program],
    setup(builder) {
      builder.hand("peak", { cardId: program.canonicalCardId, types: ["unit"], energy: 0, power: [] });
      builder.unit("ally", { location: field("one"), buffs: 0, energy: null, power: null });
      builder.unit("elsewhere", { location: field("two"), buffs: 0, energy: null, power: null });
      builder.unit("enemy", { owner: "B", controller: "B", location: field("one"), buffs: 0, energy: null, power: null });
    }
  });
  f.play("peak", { draft: { location: field("one") } });
  settle(f.engine);
  assert.equal(f.get("peak").buffs, 0);
  assert.equal(f.get("ally").buffs, 1);
  assert.equal(f.get("elsewhere").buffs, 0);
  assert.equal(f.get("enemy").buffs, 0);
  assert.equal(f.engine.pipeline.events.filter(event => event.timingPoint === "became-target").length, 0);
  assert.deepEqual(f.errors, []);
});
