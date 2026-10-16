import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/wraith-of-echoes.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const c = value => ({ kind: "constant", value });

test("Wraith of Echoes program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Wraith of Echoes identity matches ogn-118-298", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-4e64e65ef1cdade28cf4d9b17b6ebaef65f79ef63fe60a85357910c6da1deef4"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, "The first time a friendly unit dies each turn, draw 1.");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Wraith of Echoes structure: object-killed trigger, friendly unit filter, once per turn, draw 1", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-killed");
  // 383.1 / 383.1.b："the first time … each turn" = per-turn 频率限制。
  assert.equal(ability.trigger.once, "per-turn");
  // 429.1：被消灭的单位从 board 进入 trash；"friendly" = 与控制者相同。
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    object: { type: "unit", controller: "self" }
  });
  assert.equal(ability.optional, false);
  assert.equal(ability.body.length, 1);
  assert.equal(ability.body[0].id, "wraith.draw-1");
  assert.equal(ability.body[0].op, "effect.draw");
  assert.deepEqual(ability.body[0].args, { amount: c(1) });
  assert.equal(ability.body[0].targets, undefined);
  assert.equal(ability.body[0].linkedTo, undefined);
});

test("Wraith of Echoes trigger spec passes the engine's closed trigger validation", () => {
  const validated = validateTriggerSpec(ability.trigger);
  assert.equal(validated.ok, true, JSON.stringify(validated.ok ? [] : validated.issues));
});

/** Real EventPipeline + ChainEngine harness (engine-core/test/chain/helpers.mjs shape). */
function fixture() {
  const kernel = world()
    .player("A", { energy: 20 })
    .player("B", { energy: 20 })
    .base("wraith", { energy: null, power: null, might: 5 })
    .base("ally-1", { energy: null, power: null, might: 2 })
    .base("ally-2", { energy: null, power: null, might: 2 })
    .base("enemy-1", { owner: "B", controller: "B", energy: null, power: null, might: 2 })
    .deck(["A:deck:1", "A:deck:2", "A:deck:3", "A:deck:4"])
    .build();
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: checkpoint => {
      kernel.restore(checkpoint.state);
      kernel.copyLinkedFrom(checkpoint.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose: request => {
      if (
        request.type === "select-objects" &&
        request.min === request.max &&
        request.options.length === request.min
      ) {
        return [...request.options];
      }
      if (request.type === "optional") return true;
      throw new Error(`Unexpected choice: ${request.id}`);
    },
    context: (source, controller, timingPoint) =>
      bindResolveContext(kernel, { source, controller, timingPoint }),
    testTrigger: registration => kernel.test(registration.spec.condition)
  });
  const engine = new ChainEngine({
    turnOrder: ["A", "B"],
    turnPlayer: "A",
    phase: "main",
    host,
    cleanup: () => false
  });
  return { engine, kernel };
}

function resolveAll(engine) {
  // Pending triggers are finalized by advance() and then resolved by passing
  // priority around the table (engine-core/test/chain/helpers.mjs shape).
  engine.advance();
  let guard = 0;
  while (engine.items.length) {
    if (++guard > 50) throw new Error("Nonterminating test chain");
    engine.pass(engine.priority);
  }
}

function registerWraithTrigger(fixtureState) {
  fixtureState.engine.pipeline.registerTrigger({
    id: "wraith-of-echoes",
    source: fixtureState.kernel.getObject("wraith"),
    controller: "A",
    // 空能力展开由 card-program adapter 负责（trigger 管线只消费 TriggerSpec +
    // body）；这里直接使用程序里的 TriggerSpec 与 body，不手工改写效果。
    spec: ability.trigger,
    body: ability.body
  });
}

test("golden: friendly unit death draws 1 through the real trigger pipeline", () => {
  const f = fixture();
  registerWraithTrigger(f);
  const before = f.kernel.player("A").handSize;

  f.engine.commit({ type: "kill", object: f.kernel.ref("ally-1") });
  assert.equal(f.engine.items.length, 1, "the death trigger is pending on the chain");
  assert.equal(f.engine.items[0].kind, "triggered");
  assert.equal(f.engine.items[0].controller, "A");
  resolveAll(f.engine);

  assert.equal(f.kernel.player("A").handSize, before + 1);
  assert.equal(f.kernel.zone("A", "trash").length, 1);
});

test("golden: only the first friendly death each turn draws, and enemy deaths never do", () => {
  const f = fixture();
  registerWraithTrigger(f);
  const before = f.kernel.player("A").handSize;

  // 敌方单位死亡不满足 "a friendly unit"（controller: self）。
  f.engine.commit({ type: "kill", object: f.kernel.ref("enemy-1") });
  resolveAll(f.engine);
  assert.equal(f.kernel.player("A").handSize, before);

  f.engine.commit({ type: "kill", object: f.kernel.ref("ally-1") });
  resolveAll(f.engine);
  assert.equal(f.kernel.player("A").handSize, before + 1);

  f.engine.commit({ type: "kill", object: f.kernel.ref("ally-2") });
  resolveAll(f.engine);
  assert.equal(f.kernel.player("A").handSize, before + 1, "second friendly death does not draw");
  assert.equal(f.kernel.zone("A", "trash").length, 2);
});

test("golden: the per-turn window resets after turn-start", () => {
  const f = fixture();
  registerWraithTrigger(f);
  const before = f.kernel.player("A").handSize;

  f.engine.commit({ type: "kill", object: f.kernel.ref("ally-1") });
  resolveAll(f.engine);
  assert.equal(f.kernel.player("A").handSize, before + 1);

  // 新回合：pipeline 的 clock.turn 递增，per-turn frequency key 随之变化。
  f.engine.pipeline.emit({ timingPoint: "turn-start" });
  f.engine.commit({ type: "kill", object: f.kernel.ref("ally-2") });
  resolveAll(f.engine);
  assert.equal(f.kernel.player("A").handSize, before + 2);
});

test.todo(
  "Wraith of Echoes: a source bound to the card-program registry (abilities → TriggerRegistration " +
    "expansion, RIFT-8x/91) so the trigger enters the chain without the test harness registering it"
);

test.todo(
  "Wraith of Echoes: whether the card's own death triggers ('a friendly unit' per the local catalog " +
    "text vs 'another friendly unit' per the CR v1.5 383.1.b example quote) — needs the authoritative " +
    "printing text before either reading is asserted"
);
