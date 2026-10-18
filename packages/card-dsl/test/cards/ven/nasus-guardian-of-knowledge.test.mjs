import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/nasus-guardian-of-knowledge.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import {
  matchesTriggerEvent,
  matchesTriggerObject
} from "../../../../engine-core/dist/events/pipeline-match.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { triggerRegistrations } from "../../../../engine-core/dist/programs/triggers.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import channel from "../../../../engine-core/dist/effects/instructions/effect.channel.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const [ability] = program.abilities;
const [channelInstruction] = ability.body;

test("nasus-guardian-of-knowledge: passes validateCardProgram and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(
    program.canonicalCardId,
    "card.hash-356162b4f965ef0d8365391eaacb8f6ce7a5990f15529e553d4fd98f3e20bb89"
  );
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
  assert.equal(
    program.sourceText,
    "Once each turn, when an enemy unit here dies, channel 1 rune exhausted."
  );
});

test("nasus-guardian-of-knowledge: judgeReason names the unresolved 'here' filter and location LKI", () => {
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /translateObjectFilter/);
  assert.match(program.judgeReason, /matchesTriggerEvent|matchesTriggerObject/);
  assert.match(program.judgeReason, /808\.1\.d\.3/);
  assert.match(program.judgeReason, /location|位置/);
  assert.match(program.judgeReason, /effect\.channel/);
  assert.ok(!/待实现|需要裁定/.test(program.judgeReason));
});

test("nasus-guardian-of-knowledge: 'once each turn' death trigger on an enemy unit here", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.optional, false);
  // 383.3.e.1 + 契约 3.5 的 TriggerSpec.once：每回合只执行一次。
  assert.equal(ability.trigger.once, "per-turn");
  // 808.1.d：死亡触发用 object-killed（429.1/429.2/808.1.d）。
  assert.equal(ability.trigger.at, "object-killed");
  assert.deepEqual(ability.trigger.filter, {
    event: "object-killed",
    filter: {
      type: "unit",
      controller: "opponent",
      zone: "board",
      sameLocationAs: "self"
    }
  });
  assert.equal(ability.trigger.condition, undefined);
});

test("nasus-guardian-of-knowledge: the enemy-unit filter matches only opposing units on the board", () => {
  const kernel = world()
    .base("nasus", { might: 6 })
    .unit("enemy-unit", { might: 3, controller: "B" })
    .unit("friendly-unit", { might: 3, controller: "A" })
    .hand("enemy-in-hand", { types: ["unit"], controller: "B" })
    .build();
  const filter = { type: "unit", controller: "opponent", zone: "board" };
  // 事件匹配器把 controller: "opponent" 解读为"与能力控制者不同"（170.x 的对手），
  // 这与 filter 一起构成 "an enemy unit ... on the board"。
  assert.equal(matchesTriggerObject(filter, kernel.getObject("enemy-unit"), "A"), true);
  assert.equal(matchesTriggerObject(filter, kernel.getObject("friendly-unit"), "A"), false);
  assert.equal(matchesTriggerObject(filter, kernel.getObject("enemy-in-hand"), "A"), false);
});

test("nasus-guardian-of-knowledge: real kill emissions preserve the board snapshot for the enemy-unit filter", () => {
  const { kernel, host } = fixture();
  const killed = kernel.ref("enemy");
  const result = host.execute({ type: "kill", object: killed });
  assert.equal(result.outcome.status, "done");
  assert.equal(kernel.getObject("enemy").zone, "trash");
  const emission = result.emissions.find(event => event.timingPoint === ability.trigger.at);
  assert.ok(emission);
  assert.equal(emission.object.zone, "board");
  assert.deepEqual(emission.object.ref, killed);
  // Only the supported enemy-unit portion is exercised here; the location
  // anchor still needs the integration scenario below.
  assert.equal(matchesTriggerEvent({
    event: ability.trigger.at,
    object: { type: "unit", controller: "opponent", zone: "board" }
  }, emission, "A"), true);
});

test("nasus-guardian-of-knowledge: body channels exactly 1 rune, exhausted", () => {
  assert.equal(ability.body.length, 1);
  assert.equal(channelInstruction.id, "nasus-guardian-of-knowledge.channel");
  assert.equal(channelInstruction.op, "effect.channel");
  assert.deepEqual(channelInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(channelInstruction.args.exhausted, { kind: "constant", value: true });
  assert.equal(channelInstruction.targets, undefined);
  assert.equal(channelInstruction.linkedTo, undefined);
});

test("nasus-guardian-of-knowledge: the original body channels one rune with an exhausted-entry action", () => {
  const kernel = world().rune(["top-rune", "second-rune"]).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["nasus-guardian-of-knowledge.channel.channeled"], 1);
  assert.equal(kernel.player("A").runeDeckSize, 1);
  assert.deepEqual(kernel.objectsInZone("A", "rune-zone").map(ref => ref.id), ["top-rune"]);
  assert.deepEqual(kernel.stateForTest().history.map(entry => entry.action), [
    { type: "channel-rune", player: "A", amount: 1, exhausted: true }
  ]);
});

test("nasus-guardian-of-knowledge: the channel primitive adds one rune to the pool", () => {
  const kernel = world().rune(["only-rune"]).build();
  const run = runInstruction(channel, { amount: { kind: "constant", value: 1 }, exhausted: true }, {
    world: kernel
  });
  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").runeDeckSize, 0);
  assert.equal(kernel.player("A").runePool.length, 1);
});

test("nasus-guardian-of-knowledge: the channeled rune must actually enter exhausted (431.2)", {
  todo: "TestWorld channel-rune currently ignores action.exhausted; needs the shared test-kernel entry-state fix"
}, () => {
  const kernel = world().rune(["top-rune"]).build();
  const outcome = resolveChainBody(ability.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("top-rune").exhausted, true);
});

test.todo(
  "nasus-guardian-of-knowledge: make the 'here' condition real once the trigger matcher applies " +
    "sameLocationAs (contract 3.6 anchor) against the event object's location and the source's " +
    "last-known location (808.1.d.3); the merged matchesTriggerEvent ignores it, so a death at a " +
    "different battlefield currently matches"
);
test.todo(
  "nasus-guardian-of-knowledge: subscribe once: 'per-turn' through the trigger pipeline and " +
    "assert the 383.3.e.1 single execution per turn once the 'here' anchor above registers " +
    "(frequencyKey already consumes TriggerSpec.once)"
);

// RIFT-733: the refreshed gaps, pinned against the real production seam.
test("nasus-guardian-of-knowledge: the 'here' anchor is rejected before any trigger registers", () => {
  // programs/filters.ts translateObjectFilter throws for sameLocationAs, so
  // triggerRegistrations fails and the death trigger never subscribes.
  assert.throws(
    () => translateObjectFilter({ type: "unit", controller: "opponent", zone: "board", sameLocationAs: "self" }),
    error => error.code === "judge-required" && /Unsupported filter field sameLocationAs/.test(error.message)
  );
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const registry = new ProgramRegistry([lifted]);
  const f = fixture();
  const source = { ...f.kernel.getObject("source"), cardId: program.canonicalCardId };
  assert.throws(
    () => triggerRegistrations(registry, source),
    error => error.code === "judge-required" && /Unsupported filter field sameLocationAs/.test(error.message)
  );
});

test("nasus-guardian-of-knowledge: the merged machinery cannot fan the missing location anchor out", () => {
  // The supported portion of the printed filter (an opposing board unit) still
  // matches; only the location relation is missing. A same-battlefield kill and
  // a different-battlefield kill are indistinguishable without it, which is why
  // the card must stay judge-required (808.1.d.3).
  const kernel = world()
    .unit("nasus", { might: 6, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { might: 3, controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { might: 3, controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  const supported = { type: "unit", controller: "opponent", zone: "board" };
  assert.equal(matchesTriggerObject(supported, kernel.getObject("enemy-here"), "A"), true);
  assert.equal(matchesTriggerObject(supported, kernel.getObject("enemy-elsewhere"), "A"), true);
  // trigger.matcher has no location comparison, so both deaths would fire: the
  // production event filter cannot express "here". The interpreter-side set
  // query does understand the anchor when it is given a host, which is exactly
  // the capability the event-filter seam is missing. (The concrete opponent
  // player is used because the raw set query does not resolve the relative
  // controller spelling; ChainEngine's context proxy does that.)
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("nasus") });
  const here = queryObjects({ type: "unit", controller: "B", zone: "board", sameLocationAs: "self" }, {
    context: scoped,
    host: kernel.ref("nasus"),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  });
  assert.deepEqual(here.map(object => object.ref.id), ["enemy-here"]);
});
