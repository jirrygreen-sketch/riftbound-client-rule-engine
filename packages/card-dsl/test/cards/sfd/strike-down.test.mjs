import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import detach from "../../../../engine-core/dist/effects/instructions/effect.detach.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { translateInstructionTargets, translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";

import strikeDown from "../../../dist/cards/sfd/strike-down.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

const [play] = strikeDown.abilities;
const [damageInstruction, detachInstruction] = play.body;

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

test("Strike Down is structurally valid and records the current production gaps", () => {
  const result = validateCardProgram(strikeDown);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(strikeDown.status, "judge-required");

  assert.match(strikeDown.judgeReason, /355\.5/);
  assert.match(strikeDown.judgeReason, /355\.7/);
  assert.match(strikeDown.judgeReason, /355\.8/);
  assert.match(strikeDown.judgeReason, /359\.3\.e\.12/);
  assert.match(strikeDown.judgeReason, /targeted unit/);
  assert.match(strikeDown.judgeReason, /programs\/filters\.ts:124/);
  assert.match(strikeDown.judgeReason, /effects\/interpreter\/selectors\.ts:175-176/);
  assert.match(strikeDown.judgeReason, /effects\/filters\/predicates\.ts:142-160/);
  assert.match(strikeDown.judgeReason, /chain\/picks\/linked\.ts:80-193/);
  assert.match(strikeDown.judgeReason, /唯一已知的整卡生产阻塞/);
  assert.doesNotMatch(strikeDown.judgeReason, /装备选择仍无生产生命周期/);

  assert.equal(
    strikeDown.canonicalCardId,
    "card.hash-f7e9f4f53ed55ffc9e6b1d38d72324ad29bb9ebf5f25c356bcd7f723aa08b177"
  );
  assert.equal(
    strikeDown.sourceText,
    "Choose an equipped friendly unit. It deals damage equal to its Might to an enemy unit. Then detach an Equipment from it."
  );
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

test("Strike Down production binding rejects the judge-required program before Finalize", () => {
  const f = productionPlay({
    programs: [strikeDown],
    build: (w) => w
      .player("A", { energy: 3, power: ["Body"] })
      .player("B", { energy: 3, power: ["Body"] })
      .object("strike-down", {
        owner: "A",
        controller: "A",
        cardId: strikeDown.canonicalCardId,
        types: ["spell"],
        zone: "hand",
        energy: 3,
        power: ["Body"]
      })
  });
  const before = f.kernel.snapshot();

  assert.throws(
    () => f.describe("strike-down"),
    (error) => error?.code === "judge-required" && error.message === strikeDown.judgeReason
  );
  assert.deepEqual(f.requests, []);
  assert.equal(f.engine.items.length, 0);
  assert.deepEqual(f.kernel.snapshot(), before);
});

test("Strike Down's filtered Equipment pick is produced on the real Resolve path", () => {
  // The shipped program remains blocked by `equipped`, so this probe uses a
  // structurally executable projection and removes only that unsupported
  // predicate. Every other card expression, target, Resource payment and pick
  // remains byte-for-byte the shipped IR. If this passes, the Equipment pick
  // lifecycle is not a current blocker.
  const nearExecutable = structuredClone(strikeDown);
  nearExecutable.status = "executable";
  delete nearExecutable.judgeReason;
  delete nearExecutable.abilities[0].body[0].targets[0].filter.equipped;

  const f = productionPlay({
    programs: [nearExecutable],
    answers: {
      "target:equipped-friendly-unit": ["host"],
      "target:enemy-unit": ["enemy"],
      "detach/pick%3Adetached-equipment": ["sword"]
    },
    build: (w) => w
      .player("A", { energy: 3, power: ["Body"] })
      .player("B", { energy: 3, power: ["Body"] })
      .object("strike-down", {
        owner: "A",
        controller: "A",
        cardId: nearExecutable.canonicalCardId,
        types: ["spell"],
        zone: "hand",
        energy: 3,
        power: ["Body"]
      })
      .unit("host", {
        owner: "A",
        controller: "A",
        might: 3,
        location: { type: "battlefield", id: "bf1" }
      })
      .object("sword", {
        owner: "A",
        controller: "A",
        types: ["gear"],
        tags: ["Equipment"],
        zone: "board",
        location: { type: "battlefield", id: "bf1" },
        might: 1,
        attachedTo: { id: "host", zoneEntryId: 1 }
      })
      .unit("enemy", {
        owner: "B",
        controller: "B",
        might: 5,
        location: { type: "base", player: "B" }
      })
  });

  f.engine.execute(f.describe("strike-down"));
  f.settle();

  assert.deepEqual(
    f.requests.map((request) => [request.id, request.options.map((option) => option.id ?? option)]),
    [
      ["target:equipped-friendly-unit", ["host"]],
      ["target:enemy-unit", ["enemy"]],
      ["detach/pick%3Adetached-equipment", ["sword"]]
    ]
  );
  assert.equal(f.kernel.getObject("enemy").damage, 4, "printed Might 3 + the Sword's Might Bonus 1");
  assert.equal(f.kernel.getObject("sword").attachedTo, null);
  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.deepEqual(f.engine.items, []);
});

test("Strike Down's equipped and detach filters fail closed until their producers exist", () => {
  // `equipped` is intentionally present and rejected. If callers bypass the
  // translator, the shared predicate ignores the unknown field, so a bare
  // friendly unit would be widened in; this proves why production translation
  // must fail instead of silently proceeding.
  assert.throws(
    () => translateObjectFilter(damageInstruction.targets[0].filter),
    /Unsupported filter field equipped/
  );
  assert.throws(
    () => translateInstructionTargets(play.body),
    /Unsupported filter field equipped/
  );

  const kernel = world()
    .unit("unarmed", { owner: "A", controller: "A", might: 3 })
    .build();
  const unarmed = kernel.getObject("unarmed");
  assert.equal(
    matchesObjectFilter({ type: "unit", controller: "A", equipped: true }, unarmed),
    true,
    "the raw predicate ignores the unknown key; production translation must reject it"
  );
  assert.equal(
    matchesObjectFilter({ type: "unit", controller: "A", states: "attached" }, unarmed),
    false,
    "states:attached describes the candidate being attached, not a Unit hosting Equipment"
  );
  const equipmentRef = attachEquipment(kernel, "unarmed");
  assert.equal(
    matchesObjectFilter({ type: "unit", controller: "A", states: "attached" }, unarmed),
    false,
    "a Unit remains false after it becomes equipped"
  );
  assert.equal(
    matchesObjectFilter({ type: "gear", states: "attached" }, kernel.getObject(equipmentRef.id)),
    true,
    "states:attached is true for the attached Equipment itself"
  );

  // attachedTo is a real, supported anchor in the opposite direction: the
  // Equipment candidate points at its locked host. This is not the missing
  // host -> Equipment `equipped` predicate.
  assert.deepEqual(
    translateObjectFilter(detachInstruction.picks[0].filter),
    {
      type: "gear",
      tags: ["Equipment"],
      zone: "board",
      attachedTo: { target: "equipped-friendly-unit" }
    }
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
  // not stand in for the missing equipped target predicate: production
  // translation rejects that filter before Finalize (previous test).
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
