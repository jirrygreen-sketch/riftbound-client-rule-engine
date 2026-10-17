import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/disposal-expert.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import ready from "../../../../engine-core/dist/effects/instructions/effect.ready.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";

const CARD_ID = "card.hash-b23b662b4d812531660baae2b9e4fc78660d2955cd85f9595e0a61e14f5ea7a0";
const SOURCE_TEXT =
  "I enter ready if you control no other units.\n" +
  "[Disarm 2] (When I attack, give an enemy unit here -2 :rb_might: this turn.)";

test("rad-093-167 Disposal Expert: validates, identity and source text", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // README §2: the reason names the current gaps — the card-program binding
  // (RIFT-257) and the still-unproduced attack-declared timing point.
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /attack-declared/);
  assert.match(program.judgeReason, /Disarm/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("rad-093-167 Disposal Expert: enter-ready replacement plus the Disarm 2 keyword", () => {
  assert.equal(program.abilities.length, 2);

  const replacement = program.abilities[0];
  assert.equal(replacement.kind, "replacement");
  assert.deepEqual(replacement.replaces, {
    event: "object-enters-board",
    filter: { source: "self" }
  });
  assert.deepEqual(replacement.with.map(instruction => instruction.id), ["disposal-expert.enter-ready"]);
  assert.equal(replacement.with[0].op, "effect.ready");
  assert.deepEqual(replacement.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });

  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "disarm", value: 2 });
});

test("rad-093-167 Disposal Expert: the entering gate is 'you control no other units'", () => {
  const [replacement] = program.abilities;
  assert.deepEqual(replacement.condition, {
    kind: "compare",
    left: {
      kind: "count",
      subject: "unit",
      // Contract 3.6's exclude anchor is the merged vocabulary for "other".
      filter: { type: "unit", controller: "self", zone: "board", exclude: "self" }
    },
    operator: "eq",
    right: { kind: "constant", value: 0 }
  });
});

/** Real EventPipeline + ChainEngine harness (engine-core/test/chain/helpers.mjs shape). */
function playDisposalExpert(withOtherUnit) {
  const builder = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .deck(["A:deck:1", "A:deck:2", "A:deck:3", "A:deck:4"])
    .hand("disposal-expert", { types: ["unit"], energy: 4, power: null, might: 3 });
  if (withOtherUnit) builder.unit("other-unit", { might: 2, location: { type: "base", player: "A" } });
  const kernel = builder.build();
  const base = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => {
      throw new Error(`Unexpected choice: ${request.id}`);
    },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  // bindReplacement needs object(ref) on the host adapter; the concrete
  // controller is substituted for the card's symbolic "controller" spelling the
  // same way the production Finalize binds the acting player.
  const host = { ...base, object: ref => kernel.object(ref) };
  const engine = new ChainEngine({
    turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false
  });
  const [replacement] = program.abilities;
  const ability = JSON.parse(JSON.stringify(replacement, (_key, value) =>
    value && typeof value === "object" && value.controller === "controller"
      ? { ...value, controller: "A" }
      : value));
  bindReplacement(ability, kernel.ref("disposal-expert"), { host, pipeline: engine.pipeline });
  engine.execute({
    id: "play-disposal-expert",
    controller: "A",
    source: kernel.getObject("disposal-expert"),
    kind: "unit",
    speed: "normal",
    body: []
  });
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 30) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
  return { kernel, engine };
}

test("rad-093-167 Disposal Expert: with no other unit the entry replacement really readies it (359.2.c / 369.3)", () => {
  // CR 369.3 entry replacement: the unit's default exhausted entry is replaced
  // by a ready entry, so no separate "becomes ready" timing is produced.
  const { kernel, engine } = playDisposalExpert(false);
  const played = kernel.getObject("disposal-expert");
  assert.equal(played.zone, "board");
  assert.equal(played.exhausted, false);
  assert.equal(
    engine.pipeline.events.some(event => event.timingPoint === "object-readied"),
    false
  );
});

test("rad-093-167 Disposal Expert: the default exhausted entry is kept when you control another unit", () => {
  // The gate "if you control no other units" is false, so the replacement does
  // not apply and the merged default entry orientation (359.2.c) stands.
  const { kernel } = playDisposalExpert(true);
  const played = kernel.getObject("disposal-expert");
  assert.equal(played.zone, "board");
  assert.equal(played.exhausted, true);
  assert.equal(kernel.getObject("other-unit").zone, "board");
});

test("rad-093-167 Disposal Expert: the replacement body readies the entering unit through effect.ready", () => {
  const [replacement] = program.abilities;
  const kernel = world()
    .unit("disposal-expert", {
      zone: "board",
      exhausted: true,
      location: { type: "base", player: "A" }
    })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("disposal-expert") });
  const outcome = runAbilityBody(replacement.with, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(scoped.getObject("disposal-expert").exhausted, false);
  assert.equal(outcome.events[0].action, "ready");
});

test("rad-093-167 Disposal Expert: entering ready is not a post-hoc ready of an already entered unit", () => {
  // 359.2.c / 416.1.b: a unit that is already ready is unaffected, and the
  // primitive links a zero count instead of emitting a phantom ready event.
  const [replacement] = program.abilities;
  const kernel = world()
    .unit("disposal-expert", { zone: "board", exhausted: false, location: { type: "base", player: "A" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("disposal-expert") });
  const run = runInstruction(ready, replacement.with[0].args, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.readied.count, 0);
  assert.deepEqual(run.events, []);
});

test.todo(
  "disposal-expert: registering the card's replacement and keyword abilities from the card program — shared" +
    " wiring owned by the RIFT-257 card-program binding workstream"
);
test.todo(
  "disposal-expert: [Disarm 2]'s attack trigger needs an emitted attack-declared timing point (CR 831.1.d /" +
    " 466.2.c); combat/flow.ts still throws combat-start-transaction for the role designation transaction"
);
