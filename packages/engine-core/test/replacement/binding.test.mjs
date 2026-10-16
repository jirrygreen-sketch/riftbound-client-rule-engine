import test from "node:test";
import assert from "node:assert/strict";
import { fixture, resolveAll } from "../chain/helpers.mjs";
import { bindReplacement } from "../../dist/replacement/index.js";
import { BlockedReplacementError } from "../../dist/replacement/index.js";

const constant = value => ({ kind: "constant", value });
const readySelf = { id: "state", op: "effect.ready", args: { objects: { kind: "constant", value: { kind: "source" } } } };

test("binds to a hand-zone host and stops matching after cancel", () => {
  const f = fixture({ cards: [{ id: "wanderer", types: ["unit"] }] });
  const host = f.kernel.getObject("wanderer");
  assert.equal(host.zone, "hand");
  const bound = bindReplacement(
    {
      replaces: { event: "object-killed", filter: { self: true } },
      with: [{ id: "save", op: "effect.zone", args: { target: { kind: "constant", value: { kind: "source" } }, to: constant("hand") } }]
    },
    host.ref,
    { host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: (source, controller) => f.kernel }, pipeline: f.engine.pipeline }
  );
  const death = () => f.engine.commit({ type: "kill", object: f.kernel.ref("wanderer") });
  assert.equal(death().status, "replaced");
  assert.equal(f.kernel.getObject("wanderer").zone, "hand");
  bound.cancel();
  assert.equal(death().status, "done");
  assert.equal(f.kernel.getObject("wanderer").zone, "trash");
});

test("plans the static ability body once per event and supports linked it", () => {
  const f = fixture();
  const host = f.kernel.getObject("source");
  const bound = bindReplacement(
    {
      replaces: { event: "object-killed", filter: { type: "unit" } },
      with: [{ id: "banish", op: "effect.zone", args: { target: { kind: "constant", value: { linked: "replacement.object" } }, to: constant("banishment") } }]
    },
    host.ref,
    { host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: (source, controller) => f.kernel }, pipeline: f.engine.pipeline }
  );
  assert.equal(bound.registration.id, "replacement:source:1");
  const outcome = f.engine.commit({ type: "kill", object: f.kernel.ref("enemy") });
  assert.equal(outcome.status, "replaced");
  assert.equal(f.kernel.getObject("enemy").zone, "banishment");
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-killed"), false);
});

test("rejects unsupported opcodes and windows at bind time", () => {
  const f = fixture();
  const deps = {
    host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: () => f.kernel },
    pipeline: f.engine.pipeline
  };
  assert.throws(
    () => bindReplacement({ replaces: { event: "object-killed" }, with: [{ id: "x", op: "effect.summon", args: {} }] }, f.kernel.ref("source"), deps),
    BlockedReplacementError
  );
  assert.throws(
    () => bindReplacement(
      {
        replaces: {},
        with: [{ id: "ev", op: "replacement.event", args: { event: constant({ event: "object-killed" }), window: constant("forever"), instead: [] } }]
      },
      f.kernel.ref("source"),
      deps
    ),
    BlockedReplacementError
  );
  assert.throws(
    () => bindReplacement({ replaces: {}, with: [] }, { id: "ghost", zoneEntryId: 7 }, deps),
    BlockedReplacementError
  );
});

test("replacement.event plans an instead body and binds replacement.object", () => {
  const f = fixture();
  const host = f.kernel.getObject("source");
  bindReplacement(
    {
      replaces: {},
      with: [{
        id: "ev",
        op: "replacement.event",
        args: {
          event: constant({ event: "object-killed", filter: { type: "unit" } }),
          instead: [{ id: "banish", op: "effect.zone", args: { target: { kind: "constant", value: { linked: "replacement.object" } }, to: constant("banishment") } }]
        }
      }]
    },
    host.ref,
    { host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: () => f.kernel }, pipeline: f.engine.pipeline }
  );
  const outcome = f.engine.commit({ type: "kill", object: f.kernel.ref("enemy") });
  assert.equal(outcome.status, "replaced");
  assert.equal(f.kernel.getObject("enemy").zone, "banishment");
  resolveAll(f.engine);
  assert.equal(f.engine.items.length, 0);
});

test("empty replacement.event body prevents the event", () => {
  const f = fixture();
  bindReplacement(
    { replaces: {}, with: [{ id: "ev", op: "replacement.event", args: { event: constant({ event: "damage" }), instead: [] } }] },
    f.kernel.ref("source"),
    { host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: () => f.kernel }, pipeline: f.engine.pipeline }
  );
  const outcome = f.engine.commit({ type: "damage", source: f.kernel.ref("source"), target: f.kernel.ref("enemy"), amount: 2, combat: false });
  assert.equal(outcome.status, "prevented");
  assert.equal(f.kernel.getObject("enemy").damage, 0);
});
