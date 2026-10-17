import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/shen-leader-of-the-kinkou-order.js";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { TurnFlow } from "../../../../engine-core/dist/turn/flow.js";

const CANONICAL_ID =
  "card.hash-66a1a38d0f80c94dd99d8c34671b92d3e97ad609edb9693e7c2f2f31a8e70aa5";
const SOURCE_TEXT =
  "[Shield] (+1 :rb_might: while I'm a defender.)\n" +
  "When I hold, if there is exactly one other unit you control here, you score 1 point.";

const [shield, holdAbility] = program.abilities;
const [scoreOne] = holdAbility.body;

const shenKernel = (companion) => {
  const builder = world()
    .player("controller")
    .unit("shen", {
      controller: "controller",
      might: 7,
      location: { type: "battlefield", id: "bf-1" }
    });
  if (companion === "here") {
    builder.unit("ally", { controller: "controller", location: { type: "battlefield", id: "bf-1" } });
  } else if (companion === "elsewhere") {
    builder.unit("ally", { controller: "controller", location: { type: "battlefield", id: "bf-2" } });
  } else if (companion === "second") {
    builder
      .unit("ally-1", { controller: "controller", location: { type: "battlefield", id: "bf-1" } })
      .unit("ally-2", { controller: "controller", location: { type: "battlefield", id: "bf-1" } });
  }
  const base = builder.build();
  return base.clone({ controller: "controller", sourceSnapshot: base.getObject("shen") });
};

test("ven-138-166 Shen, Leader of the Kinkou Order: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ven-138-166 Shen: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /scheduleScore/);
  assert.match(program.judgeReason, /here/);
  assert.match(program.judgeReason, /190\.6/);
});

test("ven-138-166 Shen: [Shield] is declared as a merged keyword", () => {
  assert.deepEqual(shield, { kind: "keyword", keyword: "shield" });
  // 814.1.b.3: Shield with no printed value presumes 1.
  assert.equal(shield.value, undefined);
  assert.ok(keywordDefinitionsById.get("Shield"), "the Shield KeywordDef is merged");
});

test("ven-138-166 Shen: the Hold effect triggers on the closed 'hold' timing point", () => {
  assert.equal(holdAbility.kind, "triggered");
  // 315.2.b.2 / 471.2 / 473.2.b: Hold abilities trigger when the battlefield is
  // scored in the Beginning phase's hold step.
  assert.equal(holdAbility.trigger.at, "hold");
  assert.equal(holdAbility.optional, false);
  // "held" is the closed EVENT_PATTERN_TYPES discriminant that EVENT_NAMES maps
  // to the hold timing point; here: true stays the unbound 053.3 placeholder.
  assert.deepEqual(holdAbility.trigger.filter, {
    event: "held",
    here: true,
    player: "self"
  });
});

test("ven-138-166 Shen: 'score 1 point' guarded by the exactly-one-other-unit condition", () => {
  assert.deepEqual(holdAbility.body.map(instruction => instruction.id), ["shen.score-one"]);
  assert.equal(scoreOne.op, "effect.score");
  assert.deepEqual(scoreOne.args.amount, { kind: "constant", value: 1 });
  assert.equal(scoreOne.targets, undefined);
  assert.equal(scoreOne.linkedTo, undefined);
  // 470.1 / 473.1: gaining points through effect.score is distinct from Scoring
  // a Battlefield; the instruction carries the printed count as its condition.
  assert.equal(scoreOne.condition.kind, "compare");
  assert.equal(scoreOne.condition.operator, "eq");
  assert.equal(scoreOne.condition.left.kind, "count");
  assert.equal(scoreOne.condition.left.subject, "other-friendly-units-here");
  assert.deepEqual(scoreOne.condition.left.filter, {
    type: "unit",
    zone: "board",
    controller: "controller",
    sameLocationAs: "self",
    exclude: "self"
  });
  assert.deepEqual(scoreOne.condition.right, { kind: "constant", value: 1 });
});

test("ven-138-166 golden: with exactly one other friendly unit here the controller scores 1 point", () => {
  const kernel = shenKernel("here");
  // The program's own instruction carries the printed condition, so the whole
  // hold-trigger body runs unmodified.
  const outcome = runAbilityBody(holdAbility.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["shen.score-one", "executed"]
  ]);
  assert.equal(kernel.player("controller").score, 1);
  assert.deepEqual(outcome.events.map(event => event.action), ["score"]);
  assert.deepEqual(outcome.linkedValues["shen.score-one.scored"], [
    { player: "controller", amount: 1 }
  ]);
});

test("ven-138-166 golden: zero, two, or elsewhere companions skip the score", () => {
  for (const companion of ["none", "elsewhere", "second"]) {
    const kernel = shenKernel(companion);
    const outcome = runAbilityBody(holdAbility.body, kernel);
    assert.equal(outcome.status, "partial", companion);
    assert.deepEqual(
      outcome.results.map(entry => [entry.result.status, entry.result.reason]),
      [["negated", "skipped"]],
      companion
    );
    assert.equal(kernel.player("controller").score, 0, companion);
    assert.deepEqual(outcome.events, [], companion);
  }
});

test("ven-138-166 Shen golden: the merged scoring flow really emits hold with the battlefield id", () => {
  const builder = world().player("A").player("B");
  for (const player of ["A", "B"]) {
    builder
      .deck(Array.from({ length: 12 }, (_, index) => `${player}:deck:${index}`), { owner: player })
      .rune(Array.from({ length: 8 }, (_, index) => `${player}:rune:${index}`), { owner: player });
  }
  builder.unit("shen", {
    controller: "A",
    might: 7,
    location: { type: "battlefield", id: "bf1" }
  });
  const kernel = builder.build();
  const choose = request => {
    if (request.type === "select-objects" && request.min === request.max && request.options.length === request.min) {
      return [...request.options];
    }
    if (request.type === "mode") return request.options[0];
    throw new AwaitChoice(request);
  };
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: saved => {
      kernel.restore(saved.state);
      kernel.copyLinkedFrom(saved.links);
    },
    objects: () => kernel.objects,
    perform: action => kernel.perform(action),
    choose,
    context: (source, controller, timingPoint) => bindResolveContext(kernel, { source, controller, timingPoint, choose }),
    testTrigger: () => false
  });
  const flow = new TurnFlow({
    host,
    player: id => kernel.player(id),
    turnOrder: ["A", "B"],
    battlefields: [{ id: "bf1", controller: "A" }, { id: "bf2", controller: null }]
  });
  flow.start();
  const hold = flow.chain.pipeline.events.filter(event => event.timingPoint === "hold");
  assert.equal(hold.length, 1);
  assert.equal(hold[0].player, "A");
  assert.deepEqual(hold[0].details, { battlefieldId: "bf1" });
  assert.equal(kernel.player("A").score, 1);
});

test("ven-138-166 Shen golden: the merged pipeline delivers the hold event to a held-filtered registration", () => {
  const source = {
    ref: { id: "shen", zoneEntryId: 1 },
    cardId: CANONICAL_ID,
    name: "Shen, Leader of the Kinkou Order",
    types: ["unit"],
    tags: [],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "battlefield", id: "bf1" },
    might: 7,
    energy: 6,
    power: ["Order"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const host = {
    checkpoint: () => null,
    restore: () => {},
    execute: () => ({ outcome: { status: "done", events: [] }, emissions: [] }),
    context: () => ({}),
    objects: () => [source],
    choose: () => {
      throw new Error("unexpected choice");
    }
  };
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const seen = [];
  pipeline.onTrigger = snapshot => seen.push(snapshot);
  pipeline.registerTrigger({
    id: "shen.hold-probe",
    source,
    controller: "A",
    optional: false,
    body: [],
    spec: { at: "hold", filter: { event: "held", player: "self" } }
  });
  pipeline.emit({ timingPoint: "hold", player: "A", details: { battlefieldId: "bf1" } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event.details.battlefieldId, "bf1");
});

test.todo(
  "ven-138-166 Shen: bind \"here\" to the hold event's battlefield payload (053.3) and resolve the " +
    "battlefield controller's abilities (190.6); the emission and RIFT-257 registrar are merged"
);
