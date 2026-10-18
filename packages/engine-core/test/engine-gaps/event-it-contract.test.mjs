import assert from "node:assert/strict";
import test from "node:test";

import {
  EFFECT_IR_V2_RULESET,
  validateCardProgram
} from "@riftbound/card-dsl";
import {
  CONTRACT_ACTION_CAPABILITY_VERSION,
  requireContractActionCapability
} from "../../dist/effects/contract.js";
import { evaluateExpression } from "../../dist/effects/interpreter/expr.js";
import {
  resolveObjectSelector,
  selectorSnapshot
} from "../../dist/effects/interpreter/selectors.js";
import { MissingInformation } from "../../dist/effects/interpreter/values.js";
import { bindResolveContext } from "../../dist/events/action-adapter.js";
import { world } from "../../dist/effects/testing/index.js";

const constant = value => ({ kind: "constant", value });
const eventSelector = { event: "it" };

function program(body, overrides = {}) {
  return {
    canonicalCardId: "test.rift-845-event-it",
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    sourceText: "synthetic event pronoun contract",
    abilities: [{ kind: "play", body }],
    ...overrides
  };
}

function eventInstruction(selector = eventSelector, extra = {}) {
  return {
    id: "read-event-object",
    op: "condition.value",
    args: {
      value: { kind: "object-property", object: selector, property: "exhausted" }
    },
    ...extra
  };
}

function bindingFor(snapshot, overrides = {}) {
  return {
    eventId: 41,
    role: "it",
    ref: { id: snapshot.ref.id, zoneEntryId: snapshot.ref.zoneEntryId },
    snapshot: structuredClone(snapshot),
    ...overrides
  };
}

function contextWithBinding(base, binding) {
  return bindResolveContext(base, { eventObject: role => role === "it" ? binding : null });
}

test("EffectIR accepts exactly one event:it selector and rejects malformed event roles", () => {
  const valid = validateCardProgram(program([eventInstruction()]));
  assert.equal(valid.ok, true, JSON.stringify(valid));

  for (const [selector, code] of [
    [{ event: "" }, "invalid-event-object-role"],
    [{ event: "source" }, "invalid-event-object-role"],
    [{ event: "target" }, "invalid-event-object-role"],
    [{ event: "it", target: "unit" }, "invalid-object-selector"],
    [{ event: 1 }, "invalid-event-object-role"]
  ]) {
    const result = validateCardProgram(program([eventInstruction(selector)]));
    assert.equal(result.ok, false, JSON.stringify(selector));
    assert.ok(result.issues.some(issue => issue.code === code), JSON.stringify(result));
  }
});

test("event:it is an ability-level referent with no TargetSpec or PickSpec declaration", () => {
  const result = validateCardProgram(program([eventInstruction()]));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.abilities[0].body[0].targets, undefined);
  assert.equal(result.value.abilities[0].body[0].picks, undefined);
});

test("selector returns the frozen event identity and snapshot instead of a current incarnation", () => {
  const kernel = world()
    .unit("buffed", { controller: "A", exhausted: false })
    .build();
  const eventSnapshot = kernel.object(kernel.ref("buffed"));
  eventSnapshot.exhausted = true;
  const binding = bindingFor(eventSnapshot);
  const context = contextWithBinding(kernel, binding);
  const environment = {
    context,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };

  const [ref] = resolveObjectSelector(eventSelector, environment);
  assert.deepEqual({ id: ref.id, zoneEntryId: ref.zoneEntryId }, binding.ref);
  assert.equal(context.targets("anything").length, 0);
  assert.equal(selectorSnapshot(ref, environment).exhausted, true);
  assert.equal(evaluateExpression(
    { kind: "object-property", object: eventSelector, property: "exhausted" },
    environment
  ), true);
  assert.equal(kernel.getObject("buffed").exhausted, false);
});

test("event:it survives a source controller change because the event snapshot is authoritative", () => {
  const kernel = world()
    .unit("source", { controller: "A" })
    .unit("event-unit", { controller: "A" })
    .build();
  const eventSnapshot = kernel.object(kernel.ref("event-unit"));
  const binding = bindingFor(eventSnapshot);
  let chooseCalls = 0;
  const context = bindResolveContext(kernel, {
    eventObject: role => role === "it" ? binding : null,
    choose() { chooseCalls++; throw new Error("event:it must not choose"); }
  });
  const environment = {
    context,
    host: kernel.ref("source"),
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  };
  assert.equal(kernel.perform({
    type: "take-control",
    object: kernel.ref("source"),
    player: "B"
  }).status, "done");
  assert.equal(kernel.perform({
    type: "take-control",
    object: kernel.ref("event-unit"),
    player: "B"
  }).status, "done");

  const [ref] = resolveObjectSelector(eventSelector, environment);
  assert.deepEqual({ id: ref.id, zoneEntryId: ref.zoneEntryId }, binding.ref);
  assert.equal(selectorSnapshot(ref, environment).controller, "A");
  assert.equal(kernel.getObject("event-unit").controller, "B");
  assert.equal(chooseCalls, 0);
});

test("missing, malformed, wrong-role, and mismatched-incarnation bindings fail closed", () => {
  const kernel = world().unit("event-unit").build();
  const eventSnapshot = kernel.object(kernel.ref("event-unit"));
  const environment = context => ({
    context,
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false
  });

  assert.throws(() => resolveObjectSelector(eventSelector, environment(kernel)), MissingInformation);
  for (const binding of [
    null,
    bindingFor(eventSnapshot, { role: "source" }),
    bindingFor(eventSnapshot, { ref: { id: eventSnapshot.ref.id, zoneEntryId: eventSnapshot.ref.zoneEntryId + 1 } }),
    bindingFor(eventSnapshot, { eventId: 0 }),
    bindingFor(eventSnapshot, { snapshot: { ...eventSnapshot, ref: { id: eventSnapshot.ref.id, zoneEntryId: eventSnapshot.ref.zoneEntryId + 1 } } })
  ]) {
    assert.throws(() => resolveObjectSelector(eventSelector, environment(contextWithBinding(kernel, binding))), MissingInformation);
  }
});

test("the legacy GameAction surface remains closed while Recall/Batch use the versioned optional capability", () => {
  const kernel = world().build();
  const recall = {
    type: "recall",
    object: { id: "unit", zoneEntryId: 1 },
    player: "A"
  };
  assert.equal("contractActions" in kernel, false);
  assert.throws(() => requireContractActionCapability(kernel), /unavailable or unsupported/);

  const calls = [];
  const context = bindResolveContext(kernel, {
    contractActions: {
      version: CONTRACT_ACTION_CAPABILITY_VERSION,
      perform(action) {
        calls.push(structuredClone(action));
        return { status: "done", events: [], receipt: { status: "committed", actions: [] } };
      }
    }
  });
  assert.throws(
    () => requireContractActionCapability(bindResolveContext(kernel, {
      contractActions: { version: "unsupported", perform: () => ({ status: "done", events: [] }) }
    })),
    /unavailable or unsupported/
  );
  assert.equal(context.contractActions.version, "riftbound.contract-actions.v1");
  assert.equal(requireContractActionCapability(context), context.contractActions);
  assert.equal(context.contractActions.perform(recall).status, "done");
  assert.deepEqual(calls, [recall]);
});

test("synthetic EffectIR v1 and old replay-shaped data still reject the new selector", async () => {
  const cardDsl = await import("@riftbound/card-dsl");
  const v1 = cardDsl.validateEffectIr({
    kind: "effect-ir",
    schemaVersion: cardDsl.EFFECT_IR_SCHEMA_VERSION,
    ruleset: cardDsl.SYNTHETIC_DEMO_RULESET,
    id: "legacy-event-it",
    body: [{
      type: "effect",
      id: "read",
      opcode: "summon.self",
      args: { event: eventSelector }
    }]
  });
  assert.equal(v1.ok, false);
  assert.ok(v1.issues.some(issue => issue.code === "unknown-argument"));

  const replayShaped = structuredClone(program([eventInstruction()]));
  replayShaped.schemaVersion = 9;
  const legacy = validateCardProgram(replayShaped);
  assert.equal(legacy.ok, false);
  assert.ok(legacy.issues.some(issue => issue.code === "unknown-field"));
});
