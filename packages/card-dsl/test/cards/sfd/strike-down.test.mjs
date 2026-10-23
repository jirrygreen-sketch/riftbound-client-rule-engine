import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import detach from "../../../../engine-core/dist/effects/instructions/effect.detach.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateInstructionTargets, translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";

import strikeDown from "../../../dist/cards/sfd/strike-down.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const [play] = strikeDown.abilities;
const [damageInstruction, detachInstruction] = play.body;

// Official sources: Core Rules v1.5 (2026-10-09),
// https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// and Radiance patch notes (effective 2026-10-16),
// https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/.
// For canonicalCardId card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177,
// 355.5/.7 target the equipped friendly Unit and enemy Unit, 418 deals
// Might-valued damage from the first target, 436.1-.4 detaches the chosen
// Equipment and leaves it at the host's location, and 337-340 govern the
// Pending/Finalize/Priority/Resolve sequence.  A is the controller.  The
// existing "production golden" below is the complete positive path; these
// source-bound assertions supplement rather than replace it.

/** Match how ChainEngine normalizes relative player fields before querying. */
const chainQuery = (kernel, controller) => (value) => {
  const normalized = { ...value };
  for (const key of ["controller", "owner"]) {
    if (normalized[key] === "self") normalized[key] = controller;
  }
  return kernel.query({}).filter((object) => {
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "opponent" && object[key] === controller) return false;
    }
    return matchesObjectFilter({
      ...normalized,
      ...(normalized.controller === "opponent" ? { controller: "any" } : {}),
      ...(normalized.owner === "opponent" ? { owner: "any" } : {})
    }, object);
  });
};

const chainContext = (kernel, controller) => new Proxy(kernel, {
  get(target, key) {
    if (key === "query") return chainQuery(target, controller);
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  }
});

function attachEquipment(kernel, hostId, id = "sword") {
  const host = kernel.getObject(hostId);
  return kernel.addObject({
    ...host,
    ref: { id, zoneEntryId: 1 },
    cardId: `card:${id}`,
    name: id,
    types: ["gear"],
    tags: ["Equipment"],
    zone: "board",
    location: host.location,
    attachedTo: kernel.ref(hostId)
  }, "board");
}

test("Strike Down is structurally valid, executable, registered and keeps its identity", () => {
  const result = validateCardProgram(strikeDown);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(strikeDown.status, "executable");
  assert.equal(strikeDown.judgeReason, undefined);

  assert.equal(
    strikeDown.canonicalCardId,
    "card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177"
  );
  assert.equal(
    strikeDown.sourceText,
    "Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit. Then detach an Equipment from it."
  );
  assert.equal(cardRegistryById.get(strikeDown.canonicalCardId), strikeDown);
});

test("Strike Down models both Finalize choices as targets and one linked Equipment pick", () => {
  assert.equal(strikeDown.abilities.length, 1);
  assert.equal(play.kind, "play");
  assert.deepEqual(
    play.body.map((instruction) => [instruction.id, instruction.op]),
    [
      ["damage", "effect.damage"],
      ["detach", "effect.detach"]
    ]
  );

  // The first Choose is a target: 359.3.e.12 calls it the targeted unit and
  // 355.5/355.7 explain that choosing a specific public Board object targets it.
  assert.equal(damageInstruction.picks, undefined);
  assert.deepEqual(damageInstruction.targets, [
    {
      id: "equipped-friendly-unit",
      filter: { type: "unit", zone: "board", controller: "you", equipped: true },
      min: 1,
      max: 1,
      selection: "one"
    },
    {
      id: "enemy-unit",
      filter: { type: "unit", zone: "board", controller: "opponent" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);

  assert.deepEqual(damageInstruction.args.amount, {
    kind: "object-attribute",
    object: { target: "equipped-friendly-unit" },
    attribute: "might"
  });
  assert.deepEqual(damageInstruction.args.source, {
    kind: "object-attribute",
    object: { target: "equipped-friendly-unit" },
    attribute: "ref"
  });

  assert.equal(detachInstruction.linkedTo, "damage");
  assert.equal(detachInstruction.targets, undefined);
  assert.equal(detachInstruction.picks.length, 1);
  assert.deepEqual(detachInstruction.picks[0], {
    id: "detached-equipment",
    options: ["dynamic:attached-equipment"],
    selection: "one",
    min: 1,
    max: 1,
    filter: {
      type: "gear",
      tags: "Equipment",
      zone: "board",
      attachedTo: { target: "equipped-friendly-unit" }
    }
  });
  assert.deepEqual(detachInstruction.args.pick, { kind: "literal", value: "detached-equipment" });
});

function strikeDownScene({ nonEquipment = false, secondEquipment = false } = {}) {
  return productionPlay({
    programs: [strikeDown],
    answers: {
      "target:equipped-friendly-unit": ["equipped-host"],
      "target:enemy-unit": ["enemy"],
      "detach/pick%3Adetached-equipment": (kernel, request) => {
        const chosen = request.options.find((option) => option.id === "sword") ?? request.options[0];
        return [kernel.ref(chosen.id)];
      }
    },
    build: (w) => {
      let builder = w
        .player("A", { energy: 3, power: ["Body"] })
        .player("B")
        .object("strike-down", {
          owner: "A",
          controller: "A",
          cardId: strikeDown.canonicalCardId,
          types: ["spell"],
          zone: "hand",
          energy: 3,
          power: ["Body"]
        })
        .unit("equipped-host", {
          owner: "A",
          controller: "A",
          might: 3,
          location: { type: "battlefield", id: "bf1" }
        })
        .unit("unarmed-host", {
          owner: "A",
          controller: "A",
          might: 3,
          location: { type: "battlefield", id: "bf1" }
        })
        .unit("enemy", {
          owner: "B",
          controller: "B",
          might: 7,
          location: { type: "base", player: "B" }
        })
        .object("sword", {
          owner: "A",
          controller: "A",
          types: ["gear"],
          tags: ["Equipment"],
          zone: "board",
          location: { type: "battlefield", id: "bf1" },
          energy: null,
          power: null,
          might: 1
        });
      if (nonEquipment) {
        builder = builder.object("ordinary-gear", {
          owner: "A",
          controller: "A",
          types: ["gear"],
          tags: [],
          zone: "board",
          location: { type: "battlefield", id: "bf1" },
          energy: null,
          power: null,
          might: null
        });
      }
      if (secondEquipment) {
        builder = builder.object("shield", {
          owner: "A",
          controller: "A",
          types: ["gear"],
          tags: ["Equipment"],
          zone: "board",
          location: { type: "battlefield", id: "bf1" },
          energy: null,
          power: null,
          might: 2
        });
      }
      return builder;
    }
  });
}

test("Strike Down production golden: Finalize, damage, payment, linked Equipment pick and detach", () => {
  const f = strikeDownScene({ secondEquipment: true });
  assert.equal(f.engine.commit({
    type: "attach",
    object: f.kernel.ref("sword"),
    host: f.kernel.ref("equipped-host")
  }).status, "done");
  assert.equal(f.engine.commit({
    type: "attach",
    object: f.kernel.ref("shield"),
    host: f.kernel.ref("equipped-host")
  }).status, "done");
  f.engine.advance();
  const draft = f.describe("strike-down");
  assert.equal(draft.kind, "spell");
  assert.equal(draft.speed, "normal");
  f.engine.execute(draft);

  assert.deepEqual(
    f.requests.map((request) => [request.id, request.options.map((option) => option.id)]),
    [
      ["target:equipped-friendly-unit", ["equipped-host"]],
      ["target:enemy-unit", ["enemy"]]
    ]
  );
  const [item] = f.engine.items;
  assert.equal(item.status, "finalized");
  assert.deepEqual(item.targetPlans.map((plan) => plan.selected), [
    [f.kernel.ref("equipped-host")],
    [f.kernel.ref("enemy")]
  ]);
  assert.equal(f.kernel.player("A").energy, 0, "3 Energy was paid during Finalize, before either Priority pass");
  assert.deepEqual(f.kernel.player("A").power, [], "1 Body Power was paid during Finalize");

  f.settle();
  assert.deepEqual(
    f.requests.map((request) => [request.id, request.options.map((option) => option.id)]),
    [
      ["target:equipped-friendly-unit", ["equipped-host"]],
      ["target:enemy-unit", ["enemy"]],
      ["detach/pick%3Adetached-equipment", ["sword", "shield"]]
    ]
  );
  assert.equal(f.kernel.getObject("enemy").damage, 6, "current Might 3 + 1 + 2 from both attached Equipment");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.deepEqual(f.kernel.getObject("shield").attachedTo, f.kernel.ref("equipped-host"));
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("strike-down").zone, "trash");
  assert.deepEqual(f.engine.items, []);

  const committed = f.kernel.stateForTest().history.map((entry) => entry.action);
  assert.deepEqual(committed.find((action) => action.type === "damage"), {
    type: "damage",
    source: f.kernel.ref("equipped-host"),
    target: f.kernel.ref("enemy"),
    amount: 6,
    combat: false
  });
  assert.deepEqual(committed.find((action) => action.type === "detach"), {
    type: "detach",
    object: f.kernel.ref("sword")
  });
});

test("Strike Down production boundary: bare and non-Equipment-attached Units are not legal targets", () => {
  for (const options of [{}, { nonEquipment: true }]) {
    const f = strikeDownScene(options);
    if (options.nonEquipment) {
      assert.equal(f.engine.commit({
        type: "attach",
        object: f.kernel.ref("ordinary-gear"),
        host: f.kernel.ref("unarmed-host")
      }).status, "done");
    }
    f.engine.advance();

    assert.throws(
      () => f.engine.execute(f.describe("strike-down")),
      (error) => error?.name === "TargetSelectionError" && error.code === "no-legal-targets"
    );
    assert.deepEqual(f.requests, []);
    assert.deepEqual(f.engine.items, []);
    assert.equal(f.kernel.player("A").energy, 3);
    assert.deepEqual(f.kernel.player("A").power, ["Body"]);
    assert.equal(f.kernel.getObject("enemy").damage, 0);
    assert.equal(f.kernel.getObject("strike-down").zone, "hand");
  }
});

test("Strike Down production boundary: losing the last Equipment after Finalize ignores the card at Resolve", () => {
  const f = strikeDownScene();
  assert.equal(f.engine.commit({
    type: "attach",
    object: f.kernel.ref("sword"),
    host: f.kernel.ref("equipped-host")
  }).status, "done");
  f.engine.advance();
  f.engine.execute(f.describe("strike-down"));
  assert.deepEqual(f.engine.items[0].targetPlans.map((plan) => plan.selected), [
    [f.kernel.ref("equipped-host")],
    [f.kernel.ref("enemy")]
  ]);

  f.engine.pass(f.engine.priority);
  assert.equal(f.engine.commit({ type: "detach", object: f.kernel.ref("sword") }).status, "done");
  f.engine.advance();
  f.settle();

  assert.equal(f.kernel.getObject("enemy").damage, 0, "CR 359.3.e.12: the target is no longer a legal equipped Unit");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.engine.items, []);
});

test("Strike Down production boundary: losing one of two Equipment remains a legal damage and Equipment pick", () => {
  const f = strikeDownScene({ secondEquipment: true });
  for (const id of ["sword", "shield"]) {
    assert.equal(f.engine.commit({
      type: "attach",
      object: f.kernel.ref(id),
      host: f.kernel.ref("equipped-host")
    }).status, "done");
  }
  f.engine.advance();
  f.engine.execute(f.describe("strike-down"));
  f.engine.pass(f.engine.priority);
  assert.equal(f.engine.commit({ type: "detach", object: f.kernel.ref("sword") }).status, "done");
  f.engine.advance();
  f.settle();

  assert.equal(f.kernel.getObject("enemy").damage, 5, "the detached Sword's +1 no longer applies; the Shield's +2 does");
  assert.deepEqual(
    f.requests.find((request) => request.id.startsWith("detach/pick"))?.options.map((option) => option.id),
    ["shield"]
  );
  assert.deepEqual(f.kernel.getObject("shield").attachedTo, null);
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
});

test("Strike Down filters translate to the production equipped and attached-Equipment predicates", () => {
  assert.deepEqual(
    translateObjectFilter(damageInstruction.targets[0].filter),
    { type: "unit", zone: "board", controller: "self", equipped: true }
  );
  assert.equal(
    translateInstructionTargets(play.body)[0].targets[0].filter.equipped,
    true
  );
  assert.deepEqual(
    translateObjectFilter(detachInstruction.picks[0].filter),
    {
      type: "gear",
      tags: ["Equipment"],
      zone: "board",
      attachedTo: { target: "equipped-friendly-unit" }
    }
  );

  const kernel = world()
    .player("A")
    .unit("host", { owner: "A", controller: "A", might: 3 })
    .build();
  const host = kernel.getObject("host");
  const filter = { type: "unit", controller: "you", equipped: true };
  assert.equal(matchesObjectFilter(filter, host, { controller: "A", objects: kernel.objects }), false);
  const equipmentRef = attachEquipment(kernel, "host");
  assert.equal(
    matchesObjectFilter(filter, kernel.getObject("host"), { controller: "A", objects: kernel.objects }),
    true
  );
  kernel.perform({ type: "detach", object: equipmentRef });
  assert.equal(
    matchesObjectFilter(filter, kernel.getObject("host"), { controller: "A", objects: kernel.objects }),
    false
  );
});

test("Strike Down damage payload uses the host target's current Might as its source", () => {
  const kernel = world()
    .unit("host", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  const hostRef = kernel.ref("host");
  const enemyRef = kernel.ref("enemy");
  attachEquipment(kernel, "host");
  const context = chainContext(kernel, "A");
  context.setTargets("equipped-friendly-unit", [hostRef]);
  context.setTargets("enemy-unit", [enemyRef]);

  const run = resolveChainBody([damageInstruction], context);
  const result = run.results[0].result;

  assert.equal(result.status, "executed");
  assert.deepEqual(result.linkedValues.dealtTo, [{ target: enemyRef, amount: 3 }]);
  assert.equal(kernel.getObject("enemy").damage, 3);
  assert.equal(run.events.length, 1);
  assert.equal(run.events[0].action, "damage");
});

test("Strike Down detach payload removes one selected Equipment from its host", () => {
  const kernel = world()
    .unit("host", { owner: "A", controller: "A", might: 3 })
    .build();
  const swordRef = attachEquipment(kernel, "host");

  const run = runInstruction(detach, { pick: "detached-equipment" }, {
    world: kernel,
    picks: { "detached-equipment": [swordRef] }
  });

  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.detached, 1);
  assert.equal(kernel.getObject("sword").attachedTo, null);
  assert.equal(kernel.history({ action: "detach" }), 1);
});

test("Strike Down linked instruction follows the CR 359.3.e.12 stale-host outcome", () => {
  // This is reference-adapter behavior for the already-locked target. It does
  // not stand in for the production golden, which exercises the complete
  // equipped target and linked pick path.
  const kernel = world()
    .unit("host", { owner: "A", controller: "A", might: 3 })
    .unit("enemy", { owner: "B", controller: "B", might: 5 })
    .build();
  const staleHost = kernel.ref("host");
  kernel.perform({ type: "kill", object: staleHost });

  const context = chainContext(kernel, "A");
  context.setTargets("equipped-friendly-unit", [staleHost]);
  context.setTargets("enemy-unit", [kernel.ref("enemy")]);
  context.setPicks("detached-equipment", []);
  const outcome = resolveChainBody(play.body, context);

  assert.equal(outcome.results[0].id, "damage");
  assert.deepEqual(outcome.results[0].result, { status: "ignored", reason: "mistargeted" });
  assert.equal(outcome.results[1].id, "detach");
  assert.equal(outcome.results[1].result.status, "ignored");
  assert.equal(kernel.getObject("enemy").damage, 0);
  assert.deepEqual(outcome.events, []);
});
