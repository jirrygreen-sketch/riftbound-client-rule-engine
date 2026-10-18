import assert from "node:assert/strict";
import test from "node:test";

import permission from "../../dist/effects/instructions/effect.play-permission.js";
import location from "../../dist/effects/instructions/continuous.location.js";
import { runInstruction, world } from "../../dist/effects/testing/index.js";
import { resolveChainBody } from "../../dist/chain/interpreter-adapter.js";
import { ContinuousEffectRegistry } from "../../dist/layers/duration.js";
import {
  canPlayFromZone,
  locationPermissionMatches,
  playPermissionAllows,
  playPermissions,
} from "../../dist/programs/play-permissions.js";
import akaliBrash from "../../../card-dsl/dist/cards/rad/akali-brash.js";

const c = value => ({ kind: "constant", value });

function registryOf(kernel) {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
}

test("effect.play-permission registers a specific banished object and keeps costs payable", () => {
  const kernel = world()
    .unit("source")
    .card("marked", { zone: "banishment", owner: "A", controller: "A", types: ["unit"] })
    .build();
  const marked = kernel.ref("marked");
  const result = runInstruction(permission, {
    objects: c({ linked: "marked-ref" }),
    zone: c("banishment"),
    payCosts: c(true),
    until: c("your-next-ending-phase"),
  }, { world: kernel, linked: { "marked-ref": marked } });

  assert.equal(result.result.status, "executed");
  assert.equal(result.linked.permission.payCosts, true);
  assert.deepEqual(result.linked.permission.objects, [marked]);
  const registry = registryOf(kernel);
  const candidate = kernel.getObject("marked");
  assert.equal(canPlayFromZone(registry, candidate, "banishment"), true);
  assert.equal(playPermissionAllows(registry, candidate), true);
  assert.equal(canPlayFromZone(registry, { id: "marked", zoneEntryId: marked.zoneEntryId + 1 }, "banishment"), false);
});

test("the representative card's original IR reaches the permission primitive", () => {
  const grant = akaliBrash.abilities[1].body[1];
  assert.equal(grant.op, "effect.play-permission");
  const kernel = world().unit("source").card("top", { zone: "banishment", owner: "A" }).build();
  const top = kernel.ref("top");
  const result = runInstruction(permission, grant.args, {
    world: kernel,
    linked: { "akaliBanish.objects": [top] },
  });
  assert.equal(result.result.status, "executed");
  assert.equal(playPermissions(registryOf(kernel), kernel.getObject("top")).length, 1);
});

test("the representative IR also executes through the default chain interpreter", () => {
  const body = akaliBrash.abilities[1].body;
  const kernel = world().unit("source").deck("top", { owner: "A" }).build();
  const result = resolveChainBody(body, kernel);
  assert.equal(result.results[1].result.status, "executed");
  assert.equal(playPermissions(registryOf(kernel), kernel.getObject("top")).length, 1);
});

test("a stale selected object is ignored and does not leave a permission behind", () => {
  const kernel = world()
    .unit("source")
    .card("marked", { zone: "banishment", owner: "A" })
    .build();
  const stale = kernel.ref("marked");
  assert.equal(kernel.perform({ type: "move-zone", object: stale, to: "trash" }).status, "done");
  const result = runInstruction(permission, {
    objects: c({ linked: "marked-ref" }), zone: c("banishment"), until: c("your-next-ending-phase")
  }, { world: kernel, linked: { "marked-ref": stale } });
  assert.deepEqual(result.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(kernel.continuousEffects.length, 0);
});

test("an ignored-cost permission is refused without registering a partial grant", () => {
  const kernel = world().unit("source").card("marked", { zone: "banishment", owner: "A" }).build();
  const result = runInstruction(permission, {
    objects: c("self"), zone: c("banishment"), payCosts: c(false)
  }, { world: kernel.clone({ sourceSnapshot: kernel.getObject("marked") }) });
  assert.deepEqual(result.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(kernel.continuousEffects.length, 0);
});

test("the next Ending Phase expiry is owned by the permission controller", () => {
  const kernel = world().unit("source").card("marked", { zone: "banishment", owner: "A" }).build();
  const result = runInstruction(permission, {
    objects: c("self"), zone: c("banishment"), until: c("your-next-ending-phase")
  }, { world: kernel.clone({ sourceSnapshot: kernel.getObject("marked") }) });
  // The source is the marked card in this run; copy the registration into a
  // registry to exercise the real duration implementation.
  assert.equal(result.result.status, "executed");
  const registry = registryOf(result.world);
  registry.expireAt({ id: "turn-end", player: "B" }, () => null);
  assert.equal(registry.list().length, 1);
  registry.expireAt({ id: "turn-end", player: "A" }, () => null);
  assert.equal(registry.list().length, 0);
});

test("open, occupied, and controller predicates are checked against current location state", () => {
  const open = { ref: { type: "battlefield", id: "open" }, occupied: false, controller: null, owner: "A", units: [] };
  const occupied = { ref: { type: "battlefield", id: "occupied" }, occupied: true, controller: "B", owner: "B", units: [{ id: "enemy", zoneEntryId: 1 }] };
  assert.equal(locationPermissionMatches({ type: "battlefield", open: true }, open.ref, { player: "A", state: open }), true);
  assert.equal(locationPermissionMatches({ type: "battlefield", open: true }, occupied.ref, { player: "A", state: occupied }), false);
  assert.equal(locationPermissionMatches({ type: "battlefield", occupied: true, controller: "opponent" }, occupied.ref, { player: "A", state: occupied }), true);
  assert.equal(locationPermissionMatches({ type: "battlefield", controller: "controller" }, occupied.ref, { player: "A", state: occupied }), false);
});

test("continuous.location carries a structured destination predicate for a selected card", () => {
  const kernel = world().hand("marked", { owner: "A", controller: "A" }).unit("source").build();
  const marked = kernel.ref("marked");
  const result = runInstruction(location, {
    permission: c({ type: "battlefield", open: true }),
    target: c("marked"),
  }, { world: kernel, targets: { marked: [marked] } });
  assert.equal(result.result.status, "executed");
  const registry = registryOf(kernel);
  assert.equal(playPermissions(registry, kernel.getObject("marked")).length, 1);
  assert.equal(playPermissionAllows(registry, kernel.getObject("marked"), { type: "battlefield", id: "open" }, {
    player: "A",
    state: { ref: { type: "battlefield", id: "open" }, occupied: false, controller: null, owner: "A", units: [] },
  }), true);
});

test("invalid location metadata rolls back before registration", () => {
  const kernel = world().hand("marked").unit("source").build();
  assert.throws(() => runInstruction(permission, {
    objects: c("self"), zone: c("banishment"), location: c({ unsupported: true })
  }, { world: kernel.clone({ sourceSnapshot: kernel.getObject("marked") }) }), /unsupported fields/);
  assert.equal(kernel.continuousEffects.length, 0);
});

