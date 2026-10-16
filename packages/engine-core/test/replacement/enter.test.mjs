import test from "node:test";
import assert from "node:assert/strict";
import { fixture, trigger, draw, c, resolveAll } from "../chain/helpers.mjs";
import { bindReplacement } from "../../dist/replacement/index.js";

const constant = value => ({ kind: "constant", value });
const deps = f => ({
  host: { object: ref => f.kernel.object(ref), objects: () => f.kernel.objects, context: () => f.kernel },
  pipeline: f.engine.pipeline
});

test("enter-exhausted rewrites the chain entry state and keeps the orientation", () => {
  const f = fixture({ cards: [{ id: "ballista", types: ["unit"] }] });
  trigger(f, "entered", { source: f.kernel.getObject("ballista"), spec: { filter: { objectId: "ballista" } } });
  bindReplacement(
    {
      replaces: { event: "object-enters-board", filter: { self: true } },
      with: [{ id: "enter", op: "replacement.enter", args: { state: constant("exhausted") } }]
    },
    f.kernel.ref("ballista"),
    deps(f)
  );
  f.engine.execute(f.card("ballista", { kind: "unit", body: [] }));
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("ballista").zone, "board");
  assert.equal(f.kernel.getObject("ballista").exhausted, true);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
});

test("accelerate-style static declaration replaces entry exhaust with ready", () => {
  const f = fixture({ cards: [{ id: "rusher", types: ["unit"] }] });
  trigger(f, "entered", { source: f.kernel.getObject("rusher"), spec: { filter: { objectId: "rusher" } } });
  bindReplacement(
    {
      replaces: { event: "object-enters-board", filter: { self: true, exhausted: true } },
      with: [{ id: "accel", op: "effect.ready", args: { objects: { kind: "constant", value: { kind: "source" } } } }]
    },
    f.kernel.ref("rusher"),
    deps(f)
  );
  f.engine.execute(f.card("rusher", { kind: "unit", body: [] }));
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("rusher").zone, "board");
  assert.equal(f.kernel.getObject("rusher").exhausted, false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
});

test("entry filter on the entering state gates the replacement", () => {
  const f = fixture({ cards: [{ id: "rusher", types: ["unit"] }] });
  bindReplacement(
    {
      replaces: { event: "object-enters-board", filter: { self: true, exhausted: true } },
      with: [{ id: "accel", op: "effect.ready", args: { objects: { kind: "constant", value: { kind: "source" } } } }]
    },
    f.kernel.ref("rusher"),
    deps(f)
  );
  // The ability only replaces the default exhausted entry while the filter
  // says exhausted: true; the direct move bypasses the entry path entirely
  // (kernel direct commit), so the card simply lands ready on the board.
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("rusher"), to: "base", location: { type: "base", player: "A" } });
  assert.equal(f.kernel.getObject("rusher").zone, "board");
  assert.equal(f.kernel.getObject("rusher").exhausted, false);
});

test("entry replacement applies once per event and a killed host stops replacing", () => {
  const f = fixture({ cards: [{ id: "ballista", types: ["unit"] }, { id: "ballista2", types: ["unit"] }] });
  bindReplacement(
    {
      replaces: { event: "object-enters-board", filter: { self: true } },
      with: [{ id: "enter", op: "replacement.enter", args: { state: constant("exhausted") } }]
    },
    f.kernel.ref("ballista"),
    deps(f)
  );
  f.engine.execute(f.card("ballista", { kind: "unit", body: [] }));
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("ballista").exhausted, true);
  f.engine.execute(f.card("ballista2", { kind: "unit", body: [] }));
  resolveAll(f.engine);
  // A different unit entering the board keeps the default orientation
  // (CR 359.2.c): ballista's own ability never applies to it.
  assert.equal(f.kernel.getObject("ballista2").exhausted, true);
});

test("replacement.enter with ready state passes the default entry through", () => {
  const f = fixture({ cards: [{ id: "gear", types: ["gear"] }] });
  trigger(f, "entered", { source: f.kernel.getObject("gear"), spec: { filter: { objectId: "gear" } } });
  bindReplacement(
    {
      replaces: { event: "object-enters-board", filter: { self: true } },
      with: [{ id: "enter", op: "replacement.enter", args: { state: constant("ready") } }]
    },
    f.kernel.ref("gear"),
    deps(f)
  );
  f.engine.execute(f.card("gear", { kind: "gear", body: [] }));
  resolveAll(f.engine);
  assert.equal(f.kernel.getObject("gear").zone, "board");
  assert.equal(f.kernel.getObject("gear").exhausted, false);
  assert.equal(f.engine.pipeline.events.some(event => event.timingPoint === "object-readied"), false);
});
