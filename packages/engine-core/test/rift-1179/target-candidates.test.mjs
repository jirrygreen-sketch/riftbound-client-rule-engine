// RIFT-1179: a Unit target is a Board Unit unless its filter explicitly names
// another zone. Core Rules v1.5 was published 2026-10-09 and is effective
// 2026-10-16:
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// Chinese card source (read 2026-10-31):
// https://content.publishing.riotgames.com/publishing-content/v2.0/public/channel/riftbound_website/list/riftbound_gallery_cards?locale=zh_CN
// CR 133.3.a: an unqualified characteristic such as "unit" refers to an object
// on the Board unless the effect names another zone. CR 141.1.a/.b: a Unit is
// a Board Game Object; the same card in Hand or Trash is a Unit card. CR
// 355.9.a.1 gives the target meaning "unit" as a Board object unless specified
// otherwise. CR 818.1.b.1/c.2 and 819.1.d require Equip and Quick-Draw to attach
// to a Unit you control.
//
// This exercises the production interpreter target enumeration from expanded
// Quick-Draw/Equip abilities and an unzoned card DSL sample (Discipline), not a
// hand-authored candidate list or fixture resolution.
import assert from "node:assert/strict";
import test from "node:test";

import discipline from "../../../card-dsl/dist/cards/ogn/discipline.js";
import equip from "../../dist/effects/keywords/Equip.js";
import quickDraw from "../../dist/effects/keywords/Quick-Draw.js";
import { world } from "../../dist/effects/testing/index.js";
import { bindResolveContext } from "../../dist/events/action-adapter.js";
import { finalizeTargetPlan, queryTargetCandidates, resolveTargetPlan } from "../../dist/target/target-plan.js";

const HOST = { canonicalCardId: "card.hash-rift-1179-equipment" };
const BATTLEFIELD_A = { type: "battlefield", id: "bf-a" };
const BATTLEFIELD_B = { type: "battlefield", id: "bf-b" };

function scene() {
  const kernel = world()
    .object("equipment", {
      cardId: HOST.canonicalCardId, types: ["gear"], tags: ["Equipment"],
      zone: "board", owner: "A", controller: "A", location: BATTLEFIELD_A,
    })
    .unit("friendly-board", {
      owner: "A", controller: "A", zone: "board", location: BATTLEFIELD_A,
    })
    .unit("opponent-board", {
      owner: "B", controller: "B", zone: "board", location: BATTLEFIELD_B,
    })
    .hand("friendly-hand", { owner: "A", controller: "A", types: ["unit"] })
    .hand("opponent-hand", { owner: "B", controller: "B", types: ["unit"] })
    .card("friendly-trash", {
      owner: "A", controller: "A", types: ["unit"], zone: "trash",
    })
    .deck("top-card")
    .build();
  return kernel.clone({ sourceSnapshot: kernel.getObject("equipment"), controller: "A" });
}

function captureRequests(kernel) {
  const requests = [];
  const context = bindResolveContext(kernel, {
    choose(request) {
      requests.push(structuredClone(request));
      return request.options ?? [];
    },
  });
  return { context, requests };
}

function targetRequests(requests) {
  return requests.filter(request => request.type === "select-objects" &&
    request.id.startsWith("target:"));
}

function summarize(kernel, refs) {
  return refs.map(ref => {
    const object = kernel.getObject(ref.id);
    assert.ok(object, `candidate ${ref.id} must resolve to a real object`);
    return `${object.zone}:${object.controller}`;
  });
}

test("RIFT-1179 target queries route unzoned Unit filters through Board default", () => {
  const kernel = scene();
  const matches = queryTargetCandidates(kernel, {
    id: "unzoned", filter: { type: "unit" }, min: 1, max: 1,
  });
  assert.deepEqual(new Set(summarize(kernel, matches)), new Set(["board:A", "board:B"]));
  assert.deepEqual(new Set(matches.map(ref => ref.id)), new Set(["friendly-board", "opponent-board"]));
});

test("RIFT-1179 target queries preserve an explicitly named Hand zone", () => {
  const kernel = scene();
  const matches = queryTargetCandidates(kernel, {
    id: "hand", filter: { type: "unit", zone: "hand" }, min: 1, max: 1,
  });
  assert.deepEqual(new Set(summarize(kernel, matches)), new Set(["hand:A", "hand:B"]));
  assert.deepEqual(new Set(matches.map(ref => ref.id)), new Set(["friendly-hand", "opponent-hand"]));
});

test("RIFT-1179 target queries bind controller and controller spelling to the ability owner", () => {
  const kernel = scene();
  for (const controller of ["self", "controller"]) {
    const matches = queryTargetCandidates(kernel, {
      id: `query-${controller}`, filter: { type: "unit", controller }, min: 1, max: 1,
    });
    assert.deepEqual(new Set(matches.map(ref => ref.id)), new Set(["friendly-board"]));
    const requests = [];
    const context = bindResolveContext(kernel, {
      choose(request) {
        requests.push(structuredClone(request));
        return [kernel.ref("friendly-board")];
      },
    });
    finalizeTargetPlan(context, {
      id: `finalize-${controller}`, filter: { type: "unit", controller }, min: 1, max: 1,
    });
    assert.deepEqual(new Set(requests[0].options.map(ref => ref.id)), new Set(["friendly-board"]));
  }
});

for (const [label, expanded, targetId] of [
  ["Quick-Draw", quickDraw.expand({ host: HOST })[1], "quick-draw-unit"],
  ["Equip", equip.expand({ host: HOST })[0], "equip-target"],
]) {
  const requirement = expanded.body[0].targets[0];
  test(`RIFT-1179 ${label} Finalize exposes only controlled Board Units`, () => {
    const kernel = scene();
    const { context, requests } = captureRequests(kernel);
    const plan = finalizeTargetPlan(context, requirement);
    const request = targetRequests(requests).find(candidate => candidate.id === `target:${targetId}`);
    assert.ok(request, `${label} emitted ${targetId}`);
    assert.deepEqual(new Set(summarize(kernel, request.options)), new Set(["board:A"]));
    assert.deepEqual(new Set(request.options.map(ref => ref.id)), new Set(["friendly-board"]));
    assert.deepEqual(plan.selected.map(ref => ref.id), ["friendly-board"]);
  });

  test(`RIFT-1179 ${label} Resolve rechecks only controlled Board Units`, () => {
    const kernel = scene();
    const { context } = captureRequests(kernel);
    const plan = finalizeTargetPlan(context, requirement, { selected: [kernel.ref("friendly-board")] });
    const resolution = resolveTargetPlan(context, plan);
    assert.equal(resolution.status, "resolved");
    assert.deepEqual(resolution.selected.map(ref => ref.id), ["friendly-board"]);
  });
}

test("RIFT-1179 unzoned Discipline Unit target excludes Hand, Trash and opposing Units", () => {
  const kernel = scene();
  const play = discipline.abilities.find(ability => ability.kind === "play");
  assert.ok(play, "Discipline has a play ability");
  const requests = [];
  const context = bindResolveContext(kernel, {
    choose(request) {
      requests.push(structuredClone(request));
      return [kernel.ref("opponent-board")];
    },
  });
  const plan = finalizeTargetPlan(context, play.body[0].targets[0]);
  const request = targetRequests(requests).find(candidate => candidate.id === "target:chosen-unit");
  assert.ok(request, "Discipline emitted its unit target");
  assert.deepEqual(new Set(summarize(kernel, request.options)), new Set(["board:A", "board:B"]));
  assert.deepEqual(new Set(request.options.map(ref => ref.id)), new Set(["friendly-board", "opponent-board"]));
  assert.deepEqual(plan.selected.map(ref => ref.id), ["opponent-board"]);
});

test("RIFT-1179 explicit Trash Unit target remains selectable", () => {
  const kernel = scene();
  const { context, requests } = captureRequests(kernel);
  const body = [{
    id: "trash-unit",
    op: "continuous.might",
    args: {
      amount: { kind: "constant", value: 1 },
      duration: { kind: "constant", value: "this-turn" },
      objects: { kind: "constant", value: { kind: "target", id: "trash-unit" } },
    },
    targets: [{
      id: "trash-unit", filter: { type: "unit", zone: "trash" },
      min: 1, max: 1, selection: "one",
    }],
  }];
  const plan = finalizeTargetPlan(context, body[0].targets[0]);
  const request = targetRequests(requests).find(candidate => candidate.id === "target:trash-unit");
  assert.ok(request, "explicit Trash target emitted a request");
  assert.deepEqual(new Set(summarize(kernel, request.options)), new Set(["trash:A"]));
  assert.deepEqual(new Set(request.options.map(ref => ref.id)), new Set(["friendly-trash"]));
  assert.deepEqual(plan.selected.map(ref => ref.id), ["friendly-trash"]);
});

test("RIFT-1179 target selection without an ability controller fails relative self closed", () => {
  const kernel = scene();
  const requests = [];
  const context = bindResolveContext(kernel, {
    controller: undefined,
    choose(request) {
      requests.push(structuredClone(request));
      return [];
    },
  });
  assert.throws(() => finalizeTargetPlan(context, {
    id: "unbound-self", filter: { type: "unit", zone: "board", controller: "self" }, min: 1, max: 1,
  }), /required target count|no-legal-targets/i);
  assert.equal(requests.some(request => request.id === "target:unbound-self"), false);
});
