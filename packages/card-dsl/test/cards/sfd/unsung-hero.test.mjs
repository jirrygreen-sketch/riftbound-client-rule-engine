import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/unsung-hero.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const BODY_ID = "unsung-hero.draw-2";

test("sfd-167-221 Unsung Hero: program validates and has expected shape", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.status, "executable");
  assert.equal(
    program.canonicalCardId,
    "card.hash-afc40c373a9fb4e48492323d7af26d3a58b824c385707dd3c269e97fee236103"
  );
  assert.equal(program.sourceText.includes("[Deathknell]"), true);
});

test("sfd-167-221 Unsung Hero: Deathknell keyword + object-killed trigger with Mighty condition", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, triggered] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "deathknell" });

  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "object-killed");
  assert.equal(triggered.trigger.filter.self, true);
  assert.equal(triggered.optional, false);

  // CR 808.1.c.2: "If I was Mighty" 在过去式下指触发进链那一刻——
  // 条件挂在 TriggerSpec 上（进链前判定），不是 body 指令级条件。
  const condition = triggered.trigger.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 5 });
  assert.equal(condition.left.kind, "object-property");
  assert.equal(condition.left.property, "might");
});

test("sfd-167-221 Unsung Hero: body draws exactly 2 with a single unlinked instruction", () => {
  const [, triggered] = program.abilities;
  assert.equal(triggered.body.length, 1);
  const [instruction] = triggered.body;
  assert.equal(instruction.id, BODY_ID);
  assert.equal(instruction.op, "effect.draw");
  assert.deepEqual(instruction.args.amount, { kind: "constant", value: 2 });
  assert.equal(instruction.targets, undefined);
  assert.equal(instruction.linkedTo, undefined);
});

test("sfd-167-221 Unsung Hero: effect.draw body executes against the reference kernel", () => {
  const [, triggered] = program.abilities;
  const [instruction] = triggered.body;
  const kernel = world().deck(["c1", "c2", "c3"]).build();
  const run = runInstruction(
    draw,
    { amount: { kind: "constant", value: 2 } },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.drawn, 2);
  assert.equal(kernel.player("A").handSize, 2);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.equal(instruction.args.amount.value, 2);
});

// Official sources: Core Rules v1.5 (2026-10-09),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// and Radiance patch notes (effective 2026-10-16),
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/.
// Rules: 708/710 (current Board Might determines Mighty), 808.1.c through
// 808.1.d.3 (Deathknell enters the Chain before the death transition and uses
// the pre-transition state), 429.1.a.1.b (object-killed collection), 337.1
// (Finalize), and 338-340 (two Priority passes before Resolve).  The canonical
// id is program.canonicalCardId and the controller is A.
//
// Timeline: A controls Unsung Hero at Might 5 -> A commits a real Kill -> the
// object-killed wave retains the exact board incarnation -> Deathknell becomes
// Pending before Trash entry -> Finalize locks the resolved draw -> A and B
// pass -> Resolve draws 2.  The condition reads the captured alive incarnation,
// not the later Trash incarnation.
function unsungFixture({ unitMight, buffs = 0 }) {
  const kernel = world()
    .player("A")
    .player("B")
    .deck(["first", "second", "third"], { owner: "A" })
    .unit("hero", {
      cardId: program.canonicalCardId,
      owner: "A",
      controller: "A",
      might: unitMight,
      buffs,
      location: { type: "battlefield", id: "bf-1" }
    })
    .build();
  const requests = [];
  const choose = request => {
    requests.push(request);
    if (request.type === "optional") return true;
    if (request.type === "select-objects" && request.min === request.max &&
        request.options.length === request.min) return [...request.options];
    throw new Error(`Unexpected production choice ${request.type} ${request.id}`);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    performContract: action => kernel.performContract(action),
    performBatchLeaf: (action, batchId) => kernel.performBatchLeafForCapability(action, batchId),
    ...kernel.deathBoundaryPort(),
    choose,
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint, choose })
  });
  const binding = createProgramBinding({ cardPrograms: [program] });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  const errors = [];
  binding.attachLifecycle(engine, error => errors.push(error));
  engine.advance();
  return { kernel, engine, binding, errors, requests };
}

function killAndSettle(f) {
  const oldRef = f.kernel.ref("hero");
  const outcome = f.engine.commit({ type: "kill", object: oldRef });
  assert.equal(outcome.status, "done");
  for (let guard = 0; f.engine.items.length; guard++) {
    assert.ok(guard < 30, "Unsung Hero's production Chain must settle");
    if (f.engine.items.some(item => item.status === "pending")) f.engine.advance();
    else f.engine.pass(f.engine.priority);
  }
  return oldRef;
}

test("sfd-167-221 Unsung Hero production golden: a real Mighty Kill queues before Trash and Resolve draws 2", () => {
  const f = unsungFixture({ unitMight: 5 });
  assert.deepEqual(f.errors, []);
  const oldRef = killAndSettle(f);

  assert.equal(f.kernel.getObject("hero").zone, "trash");
  assert.deepEqual(f.kernel.ref("hero"), { id: "hero", zoneEntryId: 2 });
  assert.deepEqual(f.kernel.zone("A", "hand").map(ref => ref.id), ["first", "second"]);
  assert.deepEqual(f.kernel.zone("A", "deck").map(ref => ref.id), ["third"]);
  const events = f.engine.pipeline.events;
  const killed = events.findIndex(event => event.timingPoint === "object-killed" &&
    event.object.ref.id === "hero");
  const pending = events.findIndex(event => event.timingPoint === "chain-item-pending" &&
    event.object.ref.id === "hero");
  const trash = events.findIndex(event => event.timingPoint === "object-enters-trash" &&
    event.object.ref.id === "hero");
  assert.ok(killed >= 0 && pending > killed && trash > pending);
  assert.deepEqual(events[killed].object.ref, oldRef);
  assert.equal(events[killed].object.zone, "board");
  assert.equal(events[killed].object.might, 5);
  assert.equal(events.filter(event => event.timingPoint === "card-drawn").length, 2);
  assert.deepEqual(f.requests, []);
});

test("sfd-167-221 Unsung Hero production boundary: not Mighty at the Kill does not queue Deathknell", () => {
  const f = unsungFixture({ unitMight: 4 });
  assert.deepEqual(f.errors, []);
  killAndSettle(f);
  assert.equal(f.kernel.getObject("hero").zone, "trash");
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "chain-item-pending"), false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "card-drawn"), false);
  assert.equal(f.kernel.player("A").handSize, 0);
  assert.equal(f.kernel.player("A").deckSize, 3);
});
