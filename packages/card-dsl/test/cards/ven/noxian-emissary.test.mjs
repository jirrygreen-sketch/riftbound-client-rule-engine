import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/noxian-emissary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { translateTriggerFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { createActionPipelineHost, bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f94f709693f78579dcd97c1ebdba7859c74403424ef6cd195238e47541869fbf";
const SOURCE_TEXT =
  "[Empower] :rb_energy_1::rb_rune_order: (:rb_energy_1::rb_rune_order:: Empower me. " +
  "Use only if not Empowered.)\n[Empowered][>][>>][Deathknell][>] Play two 1 :rb_might: " +
  "Recruit unit tokens to your base. (When I die while Empowered, get the effect.)";

const [empower, deathknellEffect] = program.abilities;
const [baseLocation, playRecruits] = deathknellEffect.body;

test("ven-128-166 Noxian Emissary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-128-166 Noxian Emissary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /727\.1\.c\.1/);
  assert.match(program.judgeReason, /empowered 计数/);
  assert.match(program.judgeReason, /Expr\.location/);
});

test("ven-128-166 Noxian Emissary: [Empower] is declared, not re-implemented (contract 3.7)", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });

});

test("ven-128-166 Noxian Emissary: the Empowered Deathknell dependent ability shape", () => {
  assert.equal(deathknellEffect.kind, "triggered");
  // 808.1.d / 429.1.a.1.b: the Deathknell trigger fires on the host being killed
  // and goes on the chain before the zone change.
  assert.equal(deathknellEffect.trigger.at, "object-killed");
  assert.deepEqual(deathknellEffect.trigger.filter, {
    self: true,
    cause: "kill",
    destination: "trash"
  });
  assert.deepEqual(deathknellEffect.trigger.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "source", property: "empowered" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.equal(deathknellEffect.optional, false);

  assert.equal(playRecruits.id, "noxian-emissary.play-two-recruits");
  assert.equal(playRecruits.op, "effect.token");
  // CR 187.1: Recruit is the 1 Might unit token.
  assert.deepEqual(playRecruits.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(playRecruits.args.amount, { kind: "constant", value: 2 });
  // 440.2.c / 185.2.a: a token that is Played is created on the Chain first.
  assert.deepEqual(playRecruits.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(baseLocation, {
    id: "noxian-emissary.base-location",
    op: "condition.value",
    args: { value: { kind: "location", value: "ability-controller-base" } }
  });
  assert.deepEqual(playRecruits.args.location, {
    kind: "linked-value", instructionId: baseLocation.id, key: "value"
  });
  assert.equal(playRecruits.targets, undefined);
  assert.equal(playRecruits.linkedTo, baseLocation.id);
});

test("ven-128-166 golden: the original token body plays two Recruits to the actual A or B controller's base", () => {
  for (const controller of ["A", "B"]) {
    const base = world().unit("emissary", { owner: controller, cardId: CANONICAL_ID }).build();
    const kernel = base.clone({ controller, sourceSnapshot: base.getObject("emissary") });
    const outcome = resolveChainBody(deathknellEffect.body, kernel);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues[`${baseLocation.id}.value`], { type: "base", player: controller });

    const recruits = kernel.query({ zone: "board", type: "unit", tag: "Recruit" });
    assert.equal(recruits.length, 2);
    for (const recruit of recruits) {
      assert.equal(recruit.name, "Recruit");
      assert.equal(recruit.might, 1);
      assert.deepEqual(recruit.tags, ["Recruit"]);
      assert.equal(recruit.owner, controller);
      assert.equal(recruit.controller, controller);
      assert.deepEqual(recruit.location, { type: "base", player: controller });
      assert.equal(recruit.isToken, true);
      assert.equal(recruit.energy, null);
      assert.equal(recruit.power, null);
    }
    assert.deepEqual(outcome.events.map(event => [event.action, event.timingPoint]), [
      ["create-token", "chain-item-pending"], ["play", "card-played"],
      ["create-token", "chain-item-pending"], ["play", "card-played"]
    ]);
    assert.deepEqual(kernel.pendingItems, []);
    assert.equal(outcome.linkedValues[`${playRecruits.id}.token.amount`], 2);
    assert.equal(outcome.linkedValues[`${playRecruits.id}.token.objects`].length, 2);
  }
});

test("ven-128-166 golden: an opponent's base destination negates the token play", () => {
  // Contract 3.6 restricts unit Base destinations to the controller's own Base;
  // the negative case must stay a truthfully reported negation.
  const kernel = world().build();
  const run = runInstruction(
    token,
    { ...playRecruits.args, location: { kind: "constant", value: { type: "base", player: "B" } } },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.events, []);
  assert.equal(run.linked["token.amount"], 0);
  assert.deepEqual(run.linked["token.objects"], []);
  assert.deepEqual(kernel.query({ zone: "board" }), []);
});

test.todo(
  "ven-128-166 Noxian Emissary: expand [Empower] with the printed 1 Energy + 1 Order Power cost " +
    "and enforce use only if not Empowered (827.1.c.1) through the keyword/cost path"
);

test.todo(
  "ven-128-166 Noxian Emissary: evaluate the Empowered dependent Deathknell gate from the host's " +
    "pre-death LKI (727.1.c.1 / 808.1.d.3 / 828.1.b.1) after the production ObjectSnapshot empowered contract is bound"
);

test("ven-128-166 Noxian Emissary golden: only an Empowered death queues the original body with pre-death LKI", () => {
  for (const empowered of [false, true]) {
    const kernel = world().unit("source", { cardId: CANONICAL_ID, might: 2 }).build();
    // Use the canonical event-aware evaluator. The legacy chain fixture's optional
    // testTrigger callback only reads its unbound kernel and cannot evaluate source LKI.
    const host = createActionPipelineHost({
      checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
      restore: saved => { kernel.restore(saved.state); kernel.copyLinkedFrom(saved.links); },
      objects: () => kernel.objects,
      perform: action => kernel.perform(action),
      choose: request => { throw new AwaitChoice(request); },
      context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint })
    });
    const engine = new ChainEngine({
      turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host,
      cleanup: chain => {
        chain.layers.setObjects(kernel.objects);
        const lethal = chain.layers.evaluateAll().filter(object => object.zone === "board" &&
          object.types.includes("unit") && object.might !== null && (object.might <= 0 || object.damage >= object.might));
        for (const object of lethal) chain.commit({ type: "kill", object: object.ref });
        return lethal.length > 0;
      }
    });
    const f = { engine, kernel };
    const source = kernel.getObject("source");
    if (empowered) assert.equal(f.engine.commit({ type: "empower", object: source.ref }).status, "done");
    f.engine.pipeline.registerTrigger({
      id: "emissary-death", source: f.kernel.getObject("source"), controller: "A",
      spec: { ...deathknellEffect.trigger, filter: translateTriggerFilter(deathknellEffect.trigger.filter, source.ref.id, "object-killed") },
      body: deathknellEffect.body, optional: false, activeZones: ["board"], boundToIncarnation: true
    });
    assert.equal(f.engine.commit({ type: "kill", object: source.ref }).status, "done");
    f.engine.advance();
    assert.equal(f.kernel.getObject("source").zone, "trash");
    assert.equal(f.engine.items.length, empowered ? 1 : 0);
    if (empowered) {
      assert.equal(f.engine.items[0].status, "finalized");
      assert.equal(f.engine.items[0].source.empowered, 1);
      assert.deepEqual(f.engine.items[0].body, deathknellEffect.body);
    }
  }
});

test.todo(
  "ven-128-166 Noxian Emissary: resolve the Deathknell token plays through the production ProgramBinding; " +
    "Recruit has cardId:null and the chain requires a real native-token play adapter (440.2.c / 185.2.a)"
);
