import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/switcheroo.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { finalizeTargetPlan, resolveTargetPlan } from "../../../../engine-core/dist/target/target-plan.js";
import { resolveLocationSelector } from "../../../../engine-core/dist/target/location/index.js";
import { queryObjects } from "../../../../engine-core/dist/effects/interpreter/selectors.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { translateObjectFilter } from "../../../../engine-core/dist/programs/filters.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-bc97ea8be41594b9d618dfc49882dc35b7da2291b707b6e49958c26e4ad49d0c";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Swap the Might of two units at the same battlefield this turn.";

const [hidden, action, play] = program.abilities;
const [swapInstruction] = play.body;
const [firstSpec, secondSpec] = swapInstruction.targets;

/**
 * chain/engine.ts resolves the static controller/owner spellings before it
 * calls the production matcher: 'self' becomes the ability controller,
 * 'opponent' excludes that player's objects, and the layers filter matcher
 * reads location: "battlefield" as the Location *type*. The reference kernel's
 * own query compares filter values literally, so the goldens below go through
 * the same normalization the production chain applies (the merged facebreaker
 * golden uses this exact helper).
 */
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

test("sfd-145-221 Switcheroo: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-145-221 Switcheroo: judgeReason names the current swap and permission gaps", () => {
  assert.match(program.judgeReason, /effect\.swap-might/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /exclude/);
  assert.match(program.judgeReason, /ProgramBindingError/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.ok(!/RIFT-(90|91|257)/.test(program.judgeReason));
});

test("sfd-145-221 Switcheroo: [Hidden] and [Action] keywords plus the printed cost", () => {
  assert.equal(program.abilities.length, 3);
  // 811 / 806: both are permission keywords; the card only names them
  // (contract 3.7), their expansions own the Hide action and timing.
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.deepEqual(action, { kind: "keyword", keyword: "action" });
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 2 }
  });
});

test("sfd-145-221 Switcheroo: two same-battlefield unit targets with an end-of-turn swap", () => {
  assert.equal(play.body.length, 1);
  assert.equal(swapInstruction.id, "switcheroo.swap-might");
  // The missing op recorded by the survey for this exact printing: an atomic
  // exchange of the two units' current Might values for the rest of the turn.
  assert.equal(swapInstruction.op, "effect.swap-might");
  assert.equal(swapInstruction.linkedTo, undefined);
  assert.deepEqual(swapInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(swapInstruction.args.targets, {
    kind: "constant",
    value: [
      { target: "switcheroo.first-unit" },
      { target: "switcheroo.second-unit" }
    ]
  });

  // "two units at the same battlefield": the first is any battlefield unit;
  // the second shares the first's Location (sameLocationAs) and cannot be the
  // same unit (exclude), both merged filter anchors (355.9.b).
  assert.deepEqual(firstSpec, {
    id: "switcheroo.first-unit",
    filter: { type: "unit", zone: "board", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  });
  assert.deepEqual(secondSpec, {
    id: "switcheroo.second-unit",
    filter: {
      type: "unit",
      zone: "board",
      sameLocationAs: { target: "switcheroo.first-unit" },
      exclude: { target: "switcheroo.first-unit" }
    },
    min: 1,
    max: 1,
    selection: "one"
  });
});

test("sfd-145-221 Switcheroo golden: the second target really resolves to another unit on the same battlefield", () => {
  // The card's own filter is evaluated by the real selector query: the anchor
  // is the first locked target, only a different unit at the same Location
  // matches, and units elsewhere on the Board never do.
  const kernel = world()
    .unit("first-unit", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("same-battlefield", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("other-battlefield", { owner: "B", controller: "B", might: 4, location: { type: "battlefield", id: "battlefield-2" } })
    .base("at-base", { owner: "B", controller: "B", might: 3 })
    .build();
  kernel.setTargets("switcheroo.first-unit", [kernel.ref("first-unit")]);
  const context = chainContext(kernel, "A");
  const environment = {
    context,
    query: (filter) => context.query(filter),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  };

  assert.deepEqual(
    queryObjects(secondSpec.filter, environment).map((object) => object.ref.id),
    ["same-battlefield"]
  );
});

test("sfd-145-221 Switcheroo golden: the merged target system locks exactly the two printed units", () => {
  // Only the Finalize-time bounds the card prints are exercised here: one unit
  // for each slot, and the second must satisfy the same-location/exclusion
  // filter. The end-of-turn swap itself has no merged primitive (judgeReason).
  const kernel = world()
    .unit("first-unit", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .unit("same-battlefield", { owner: "B", controller: "B", might: 5, location: { type: "battlefield", id: "battlefield-1" } })
    .build();

  const context = chainContext(kernel, "A");
  const firstPlan = finalizeTargetPlan(context, {
    id: firstSpec.id,
    filter: firstSpec.filter,
    min: firstSpec.min,
    max: firstSpec.max,
    selection: firstSpec.selection
  }, { selected: [kernel.ref("first-unit")] });
  assert.deepEqual(firstPlan.selected.map((ref) => ref.id), ["first-unit"]);

  kernel.setTargets(firstSpec.id, firstPlan.selected);
  const environment = {
    context,
    query: (filter) => context.query(filter),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  };
  const candidates = queryObjects(secondSpec.filter, environment).map((object) => object.ref);
  const secondPlan = finalizeTargetPlan(context, {
    id: secondSpec.id,
    filter: secondSpec.filter,
    min: secondSpec.min,
    max: secondSpec.max,
    selection: secondSpec.selection
  }, { selected: candidates });

  assert.deepEqual(secondPlan.selected.map((ref) => ref.id), ["same-battlefield"]);
  assert.equal(resolveTargetPlan(context, firstPlan).status, "resolved");
  assert.equal(resolveTargetPlan(context, secondPlan).status, "resolved");
});

test.todo(
  "sfd-145-221 Switcheroo: production resolution still needs an atomic effect.swap-might consumer that preserves both " +
    "Might values through end of turn after the two same-location targets are finalized"
);

test.todo(
  "sfd-145-221 Switcheroo: the printed [Hidden] line still needs a consumer that grants Hide, stores the card facedown, " +
    "and permits its later facedown Reaction play"
);

test("sfd-145-221 Switcheroo: the atomic effect.swap-might opcode is registered", () => {
  // 434.1.a-d / 479.4.b: the production registry now exposes the atomic Might
  // exchange and validates exactly one target selector per operand.
  const definition = instructionDefinitionsById.get("effect.swap-might");
  assert.ok(definition);
  assert.equal(swapInstruction.op, "effect.swap-might");
  assert.equal(instructionDefinitionsById.get(swapInstruction.op), definition);
  assert.equal(definition.argsSchema.safeParse({
    targets: { kind: "constant", value: [{ target: "switcheroo.first-unit" }, { target: "switcheroo.second-unit" }] },
    duration: { kind: "constant", value: "this-turn" }
  }).success, true);
});

test("sfd-145-221 Switcheroo: the production target translator preserves both dynamic anchors", () => {
  // 355.9.b: the second target keeps the first target's same-location relation
  // and the source exclusion through the closed filter vocabulary.
  assert.deepEqual(translateObjectFilter(secondSpec.filter), {
    type: "unit",
    zone: "board",
    sameLocationAs: { target: "switcheroo.first-unit" },
    exclude: { target: "switcheroo.first-unit" }
  });
  // Only the first slot's plain filter survives translation; it carries no
  // relation to the first target.
  assert.deepEqual(
    translateObjectFilter(firstSpec.filter),
    { type: "unit", zone: "board", location: "battlefield" }
  );
});

test("sfd-145-221 Switcheroo: TargetSpec.location cannot read a prior target yet", () => {
  // Live evidence for the second half of judgeReason (2): the merged location
  // selector kind exists, but a Finalize context that has written no prior
  // selection cannot resolve it, so the dynamic anchor has no runtime source.
  const kernel = world()
    .unit("first-unit", { owner: "A", controller: "A", might: 2, location: { type: "battlefield", id: "battlefield-1" } })
    .build();
  const context = chainContext(kernel, "A");
  const environment = {
    context,
    query: (filter) => context.query(filter),
    linked: () => undefined,
    canLookBack: () => false,
    isIgnored: () => false
  };

  assert.deepEqual(context.targets("switcheroo.first-unit"), []);
  assert.throws(
    () => resolveLocationSelector({ kind: "target-location", target: "switcheroo.first-unit" }, environment),
    /Target has no runtime location/
  );
});
