import assert from "node:assert/strict";
import test from "node:test";
import zone from "../../../dist/effects/instructions/effect.zone.js";
import {
  AwaitChoice,
  runInstruction,
  world
} from "../../../dist/effects/testing/index.js";

const expr = value => ({ kind: "constant", value });
const targetRun = (kernel, args, ref, options = {}) => runInstruction(zone, args, {
  world: kernel,
  targets: { selected: [ref] },
  ...options
});

test("moves a selected object and links the actual count", () => {
  const kernel = world().unit("unit").build();
  const result = targetRun(kernel, { target: "selected", to: expr("hand") }, kernel.ref("unit"));

  assert.equal(result.result?.status, "executed");
  assert.equal(kernel.getObject("unit")?.zone, "hand");
  assert.equal(result.linked.moved, 1);
  assert.deepEqual(result.linked.movedIds, ["unit"]);
  assert.equal(result.linked.destination, "hand");
  assert.equal(result.events[0].action, "return-to-hand");
});

test("a replacement hook negates the zone action", () => {
  const kernel = world().unit("unit").build();
  kernel.addReplacement(action => action.type === "return-to-hand" ? "replaced" : null);

  const result = targetRun(kernel, { target: "selected", to: expr("hand") }, kernel.ref("unit"));

  assert.equal(result.result?.status, "negated");
  assert.equal(result.result?.reason, "replaced");
  assert.equal(result.result?.events.length, 1);
  assert.equal(kernel.getObject("unit")?.zone, "board");
});

test("a stale zoneEntryId is ignored after the object leaves its zone", () => {
  const kernel = world().unit("unit").build();
  const stale = kernel.ref("unit");
  kernel.perform({ type: "move-zone", object: stale, to: "hand" });

  const result = targetRun(kernel, { target: "selected", to: expr("trash") }, stale);

  assert.deepEqual(result.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.getObject("unit")?.zone, "hand");
  assert.equal(result.events.length, 0);
});

test("zero amount executes without moving a valid target", () => {
  const kernel = world().unit("unit").build();
  const result = targetRun(kernel, {
    target: "selected",
    amount: expr(0),
    to: expr("trash")
  }, kernel.ref("unit"));

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.moved, 0);
  assert.deepEqual(result.linked.movedIds, []);
  assert.equal(kernel.getObject("unit")?.zone, "board");
  assert.equal(result.events.length, 0);
});

test("an amount above the available selection moves as many as possible", () => {
  const kernel = world().unit("first").unit("second").build();
  const result = runInstruction(zone, {
    target: "selected",
    amount: expr(5),
    to: expr("trash")
  }, {
    world: kernel,
    targets: { selected: [kernel.ref("first"), kernel.ref("second")] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(result.linked.moved, 2);
  assert.equal(kernel.getObject("first")?.zone, "trash");
  assert.equal(kernel.getObject("second")?.zone, "trash");
});

test("a destination choice suspends and replays with its answer", () => {
  const kernel = world().unit("unit").build();
  const args = {
    target: "selected",
    choice: {
      id: "zone-destination",
      options: ["hand", "trash"]
    }
  };
  const pending = targetRun(kernel, args, kernel.ref("unit"));

  assert.ok(pending.asked instanceof AwaitChoice);
  assert.equal(pending.asked.request.id, "zone-destination");
  assert.equal(kernel.getObject("unit")?.zone, "board");

  const answered = targetRun(kernel, args, kernel.ref("unit"), { answers: { "zone-destination": "hand" } });
  assert.equal(answered.result?.status, "executed");
  assert.equal(answered.linked.destination, "hand");
  assert.equal(kernel.getObject("unit")?.zone, "hand");
});

test("pick moves a non-target selection without using target resolution", () => {
  const kernel = world().object("gear", {
    types: ["gear"],
    zone: "board",
    location: { type: "battlefield", id: "battlefield-1" }
  }).build();
  const result = runInstruction(zone, { pick: "gear-pick", to: expr("hand") }, {
    world: kernel,
    picks: { "gear-pick": [kernel.ref("gear")] }
  });

  assert.equal(result.result?.status, "executed");
  assert.equal(kernel.getObject("gear")?.zone, "hand");
  assert.equal(result.events[0].action, "return-to-hand");
});

test("SFD-026A/221 Rumble, Hotheaded recycles another friendly unit", () => {
  const kernel = world().unit("friendly-mech").build();
  const result = targetRun(kernel, { target: "selected", to: expr("deck-bottom") }, kernel.ref("friendly-mech"));

  assert.equal(result.result?.status, "executed");
  assert.equal(kernel.getObject("friendly-mech")?.zone, "deck");
  assert.equal(result.events[0].action, "recycle");
});

test("SFD-071/221 Breakneck Mech moves between battlefields", () => {
  const kernel = world().unit("breakneck", {
    location: { type: "battlefield", id: "battlefield-1" }
  }).build();
  const before = kernel.ref("breakneck");
  const result = targetRun(kernel, {
    target: "selected",
    to: expr("battlefield"),
    location: expr({ type: "battlefield", id: "battlefield-2" })
  }, kernel.ref("breakneck"));

  assert.equal(result.result?.status, "executed");
  assert.deepEqual(kernel.getObject("breakneck")?.location, {
    type: "battlefield",
    id: "battlefield-2"
  });
  assert.equal(kernel.ref("breakneck").zoneEntryId, before.zoneEntryId);
  assert.equal(result.events[0].action, "move-location");
});
