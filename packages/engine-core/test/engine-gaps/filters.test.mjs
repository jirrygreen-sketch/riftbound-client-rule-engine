import assert from "node:assert/strict";
import test from "node:test";

import { matchesObjectFilter } from "../../dist/layers/filter.js";
import { queryObjects } from "../../dist/effects/interpreter/selectors.js";

const ref = (id, zoneEntryId = 1) => ({ id, zoneEntryId });
const object = (id, values = {}) => ({
  ref: ref(id, values.zoneEntryId ?? 1),
  cardId: values.cardId ?? `card:${id}`,
  name: id,
  types: values.types ?? ["unit"],
  tags: values.tags ?? [],
  keywords: values.keywords ?? [],
  owner: values.owner ?? "A",
  controller: values.controller ?? values.owner ?? "A",
  zone: values.zone ?? "board",
  location: values.location === undefined ? { type: "battlefield", id: "bf-1" } : values.location,
  might: values.might === undefined ? 3 : values.might,
  energy: values.energy === undefined ? null : values.energy,
  power: values.power === undefined ? null : values.power,
  exhausted: values.exhausted ?? false,
  damage: values.damage ?? 0,
  stunned: values.stunned ?? false,
  buffs: values.buffs ?? 0,
  attachedTo: values.attachedTo ?? null,
  faceDown: values.faceDown ?? false,
  isToken: values.isToken ?? false,
  ...values,
});

const layered = (id, values = {}) => {
  const current = object(id, values);
  return { ...current, printed: values.printed ?? current };
};

function environment(objects, source = objects[0], controller = source.controller) {
  const byRef = new Map(objects.map(item => [`${item.ref.id}:${item.ref.zoneEntryId}`, item]));
  return {
    context: {
      source,
      controller,
      timingPoint: "main-start",
      object: candidate => byRef.get(`${candidate.id}:${candidate.zoneEntryId}`) ?? null,
      lastKnown: candidate => byRef.get(`${candidate.id}:${candidate.zoneEntryId}`) ?? null,
      query: () => objects,
      targets: id => id === "target" ? [objects[1].ref] : [],
      picks: () => [],
      linked: () => undefined,
    },
    linked: () => undefined,
    canLookBack: () => true,
    isIgnored: () => false,
  };
}

test("EG-FILTERS: structured LocationRef compares by value", () => {
  const candidate = layered("candidate", { location: { type: "battlefield", id: "bf-1" } });
  assert.equal(matchesObjectFilter({ location: { type: "battlefield", id: "bf-1" } }, candidate), true);
  assert.equal(matchesObjectFilter({ location: { type: "battlefield" } }, candidate), true);
  assert.equal(matchesObjectFilter({ location: { type: "battlefield", id: "bf-2" } }, candidate), false);
  assert.equal(matchesObjectFilter({ location: { type: "base", player: "A" } }, candidate), false);
});

test("EG-FILTERS: strict state, keyword, damaged, buffed and empowered predicates", () => {
  const candidate = layered("candidate", {
    damage: 1,
    buffs: 2,
    keywords: [{ id: "deploy" }],
    empowered: 2,
  });
  assert.equal(matchesObjectFilter({ damaged: true, buffed: true, hasKeyword: "Deploy", empowered: true }, candidate), true);
  assert.equal(matchesObjectFilter({ states: ["damaged", "buffed", "empowered"] }, candidate), true);
  assert.equal(matchesObjectFilter({ damaged: false }, candidate), false);
  assert.equal(matchesObjectFilter({ hasKeyword: "shield" }, candidate), false);
  assert.equal(matchesObjectFilter({ empowered: false }, candidate), false);
});

test("EG-FILTERS: current Might and printed costs use ordered comparisons and preserve null", () => {
  const candidate = layered("candidate", {
    might: 3,
    energy: 99,
    power: ["Fury"],
    printed: object("candidate", { might: 3, energy: 2, power: 1 }),
  });
  assert.equal(matchesObjectFilter({ mightLte: 3 }, candidate), true);
  assert.equal(matchesObjectFilter({ mightLte: 2 }, candidate), false);
  assert.equal(matchesObjectFilter({ energyMax: 2, powerMax: 1 }, candidate), true);
  assert.equal(matchesObjectFilter({ energyMax: 1 }, candidate), false);
  assert.equal(matchesObjectFilter({ energyMax: 2 }, layered("null-cost", { printed: object("null-cost", { energy: null, power: null }) })), false);
});

test("EG-FILTERS: relative players and relation anchors resolve from the query source", () => {
  const source = object("source", { controller: "A", location: { type: "battlefield", id: "bf-1" } });
  const friendly = object("friendly", { controller: "A", location: { type: "battlefield", id: "bf-1" }, might: 2 });
  const enemy = object("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" }, might: 1 });
  const other = object("other", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" }, might: 5 });
  const env = environment([source, friendly, enemy, other], source, "A");
  assert.deepEqual(queryObjects({ type: "unit", controller: "opponent", sameLocationAs: "source", mightLessThan: "source" }, env).map(item => item.ref.id), ["enemy"]);
  assert.deepEqual(queryObjects({ relation: { relation: "same-controller", object: "source" } }, env).map(item => item.ref.id), ["source", "friendly"]);
  assert.deepEqual(queryObjects({ sameLocationAs: "source", exclude: "source" }, env).map(item => item.ref.id), ["friendly", "enemy"]);
});

test("EG-FILTERS: dynamic queries deduplicate by zone-bound identity and retain null characteristics", () => {
  const source = object("source", { location: null, energy: null, power: null });
  const first = object("unit", { zoneEntryId: 1, location: null, energy: null, power: null });
  const second = object("unit", { zoneEntryId: 2, location: null, energy: null, power: null });
  const env = environment([source, first, first, second], source, "A");
  const result = queryObjects({}, env);
  assert.deepEqual(result.map(item => `${item.ref.id}:${item.ref.zoneEntryId}`), ["source:1", "unit:1", "unit:2"]);
  assert.equal(result[1].energy, null);
  assert.equal(result[1].power, null);
  assert.equal(result[1].location, null);
});
