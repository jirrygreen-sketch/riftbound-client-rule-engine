import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/startipped-peak.js";
// effect.channel declares Expr-typed arguments, so the body runs through the
// production chain adapter (engine-core/src/chain/interpreter-adapter.ts).
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { assertTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
const enginePipeline = await import("../../../../engine-core/dist/events/pipeline.js");

const CANONICAL = "card.hash-3baf147c819e802d3468d8c30b6fb475909fc861e0dda2bdaa7adba32bfc23e9";
const [ability] = program.abilities;
const [optional] = ability.body;
const [channel] = optional.args.body.value;

/** A minimal board host snapshot for the direct pipeline registration test. */
const abilitySource = {
  ref: { id: "startipped-peak", zoneEntryId: 1 },
  cardId: CANONICAL,
  name: "Startipped Peak",
  types: ["battlefield"],
  tags: [],
  keywords: [],
  owner: "A",
  controller: "A",
  zone: "board",
  location: { type: "battlefield", id: "battlefield-1" },
  might: null,
  energy: null,
  power: null,
  exhausted: false,
  damage: 0,
  stunned: false,
  buffs: 0,
  attachedTo: null,
  faceDown: false,
  isToken: false
};

test("ogn-288-298 Startipped Peak: program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /hold/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /battlefieldId/);
  assert.equal(program.sourceText, "When you hold here, you may channel 1 rune exhausted.");
});

test("ogn-288-298: optional hold trigger that channels 1 rune exhausted (431.2)", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "hold");
  assert.deepEqual(ability.trigger.filter, { event: "hold", here: true, player: "controller" });
  // "you may": optional flag plus the chosen instruction inside the choice body
  // (contract 3.9).
  assert.equal(ability.optional, true);
  assert.equal(ability.body.length, 1);
  assert.equal(optional.id, "startipped-peak.channel-opt");
  assert.equal(optional.op, "choice.optional");
  assert.deepEqual(optional.args.prompt, {
    kind: "constant",
    value: "Channel 1 rune exhausted?"
  });
  assert.equal(optional.args.body.kind, "constant");
  assert.equal(optional.args.body.value.length, 1);

  assert.equal(channel.id, "startipped-peak.channel");
  assert.equal(channel.op, "effect.channel");
  assert.equal(channel.linkedTo, undefined);
  assert.deepEqual(channel.args.amount, { kind: "constant", value: 1 });
  // The stipulation "exhausted" (431.2) is carried on the instruction; the
  // recipient defaults to the ability controller.
  assert.deepEqual(channel.args.exhausted, { kind: "constant", value: true });
  assert.equal(channel.args.player, undefined);
  assert.equal(channel.targets, undefined);
});

test("ogn-288-298: accepting the option channels one rune", () => {
  const kernel = world().rune(["rune-top", "rune-second"]).build();
  kernel.setAnswers({ "startipped-peak.channel-opt/optional": true });
  const ran = resolveChainBody(ability.body, kernel);
  assert.equal(ran.status, "executed");
  assert.deepEqual(
    ran.results.map(entry => entry.id + ":" + entry.result.status),
    ["startipped-peak.channel:executed", "startipped-peak.channel-opt:executed"]
  );
  assert.deepEqual(ran.events.map(event => event.action), ["channel-rune"]);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 1);
  assert.equal(kernel.getObject("rune-top").zone, "rune-zone");
  assert.equal(kernel.getObject("rune-second").zone, "rune-deck");
});

test("ogn-288-298: declining the option channels nothing and skips the body", () => {
  const kernel = world().rune(["rune-top"]).build();
  kernel.setAnswers({ "startipped-peak.channel-opt/optional": false });
  const ran = resolveChainBody(ability.body, kernel);
  assert.equal(ran.results[0].result.status, "negated");
  assert.equal(ran.results[0].result.reason, "skipped");
  assert.deepEqual(ran.events, []);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.equal(kernel.player("A").runePool.length, 0);
});

test("ogn-288-298: the trigger filter still carries the unreplaced here placeholder", () => {
  assert.throws(() => assertTriggerSpec(ability.trigger), /EventPattern 不允许此字段/);
});

test("ogn-288-298: the hold timing point is emitted by the merged scoring flow with a battlefieldId detail", () => {
  // turn/flow.ts emits "hold" inside the Beginning Scoring Step and carries the
  // held battlefield as details.battlefieldId; the merged pipeline delivers it
  // to registrations whose spec matches. The card-side gap is the "here"
  // anchor and the CardProgram trigger binding, not the emission itself.
  const { EventPipeline } = enginePipeline;
  const host = {
    checkpoint: () => null,
    restore: () => {},
    execute: () => ({ outcome: { status: "done", events: [] }, emissions: [] }),
    context: () => ({}),
    objects: () => [abilitySource],
    choose: () => { throw new Error("unexpected choose"); }
  };
  const pipeline = new EventPipeline(host, ["A", "B"], "A");
  const seen = [];
  pipeline.onTrigger = (snapshot) => seen.push(snapshot);
  // The closed EventPattern vocabulary names this event "held"; the matcher
  // maps it to the "hold" timing point (events/pipeline-match.ts EVENT_NAMES).
  pipeline.registerTrigger({
    id: "test.hold.plain",
    source: abilitySource,
    controller: "A",
    spec: { at: "hold", filter: { event: "held", player: "self" } },
    body: []
  });
  pipeline.emit({ timingPoint: "hold", player: "A", details: { battlefieldId: "battlefield-1" } });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].event.details.battlefieldId, "battlefield-1");
});

test.todo(
  "ogn-288-298: binding the here-anchored hold filter and the card program's triggered ability into " +
    "the pipeline (RIFT-257) remains pending"
);
test.todo(
  "ogn-288-298: 431.2 的“exhausted 入场”状态由内核实现——参考测试内核的 channel-rune 不记录符文入场状态" +
    "（449 类位置状态归真实内核；本地只验证符文离开符文牌库进入符文区）"
);
