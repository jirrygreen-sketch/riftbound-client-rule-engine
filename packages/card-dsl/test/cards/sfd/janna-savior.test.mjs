import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/janna-savior.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { ChainEngine } from "../../../../engine-core/dist/chain/engine.js";
import { attachProgramLifecycle } from "../../../../engine-core/dist/programs/lifecycle.js";
import { ProgramRegistry } from "../../../../engine-core/dist/programs/registry.js";
import { createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-e34490aeafd0b93f586a5515c869f58c08f344fc4fc7477abdf4e24ada222632";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve, including to a battlefield you control.)\n" +
  "When you play me, heal your units here, then move an enemy unit from here to its base.";
const BATTLEFIELD = { type: "battlefield", id: "bf-1" };
const OTHER_BATTLEFIELD = { type: "battlefield", id: "bf-2" };

const [reaction, ability] = program.abilities;
const [healHere, moveEnemyHome] = ability.body;

/**
 * Emulates the production query wrapper for the goldens below: the chain's
 * query (chain/engine.ts) normalizes only the "self" placeholder and rejects
 * opponents, then defers the remaining fields — including the sameLocationAs
 * anchor — to the interpreter's runtime queryObjects, which performs the real
 * location comparison (see the chain goldens below).
 */
function productionContext(kernel) {
  const query = (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self") normalized[key] = kernel.controller;
    }
    if (normalized.controller === "opponent" || normalized.owner === "opponent") {
      const key = normalized.controller === "opponent" ? "controller" : "owner";
      normalized[key] = "any";
      return kernel.objects.filter((object) => object[key] !== kernel.controller && matchesObjectFilter(normalized, object));
    }
    return kernel.objects.filter((object) => matchesObjectFilter(normalized, object));
  };
  return bindResolveContext(kernel, { query });
}

const jannaWorld = () => world()
  .unit("janna", { might: 3, location: BATTLEFIELD })
  .unit("ally-here", { might: 2, location: BATTLEFIELD, damage: 2, owner: "A", controller: "A" })
  .unit("ally-far", { might: 2, location: OTHER_BATTLEFIELD, damage: 1, owner: "A", controller: "A" })
  .unit("enemy-here", { might: 2, location: BATTLEFIELD, owner: "B", controller: "B" })
  .unit("enemy-elsewhere", { might: 2, location: OTHER_BATTLEFIELD, owner: "B", controller: "B" })
  .build();

const boundWorld = (kernel) => kernel.clone({ source: kernel.ref("janna"), sourceSnapshot: kernel.getObject("janna") });

test("sfd-053-221 Janna, Savior: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-053-221 Janna, Savior: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /translateObjectFilter|filters\.ts/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-053-221 Janna, Savior: [Reaction] keyword plus a card-played trigger with two independent instructions", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(reaction, { kind: "keyword", keyword: "reaction" });

  // 383.4.a / 420.4.a: "When you play me" fires once the play action completes.
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "card-played");
  assert.deepEqual(ability.trigger.filter, { event: "card-played", filter: { source: "self" } });
  assert.equal(ability.optional, false);

  // "then" joins two printed instructions; the move does not consume the heal's
  // result, so the instructions stay unlinked (359.3.e.14).
  assert.deepEqual(ability.body.map((instruction) => [instruction.id, instruction.op]), [
    ["janna-savior.heal-units-here", "effect.heal"],
    ["janna-savior.move-enemy-home", "effect.move"]
  ]);
  assert.equal(moveEnemyHome.linkedTo, undefined);
});

test("sfd-053-221 Janna, Savior: the heal is an each-set of your units here, not a target choice (355.10.d)", () => {
  // 419.1/419.2: Heal clears marked damage; "your units here" is a set selected
  // by characteristics, so no TargetSpec/pick is declared.
  assert.deepEqual(healHere.args.objects, {
    kind: "constant",
    value: {
      kind: "query",
      filter: {
        type: "unit",
        zone: "board",
        controller: "self",
        sameLocationAs: "self"
      }
    }
  });
  assert.equal(healHere.targets, undefined);
  assert.equal(healHere.picks, undefined);
});

test("sfd-053-221 Janna, Savior: the enemy unit here is a target and its destination is its own base (421.1)", () => {
  // 355.5/355.7: "move an enemy unit from here" names the object -> target.
  assert.deepEqual(moveEnemyHome.targets, [
    {
      id: "janna-savior.enemy-unit-here",
      filter: { type: "unit", zone: "board", controller: "opponent", sameLocationAs: "self" },
      min: 1,
      max: 1,
      selection: "one"
    }
  ]);
  // "to its base": the destination follows each moved object's controller.
  assert.deepEqual(moveEnemyHome.args.to, { kind: "constant", value: "controller-base" });
});

test("sfd-053-221 Janna, Savior golden: healing hits your units here and spares units elsewhere", () => {
  const kernel = boundWorld(jannaWorld());
  kernel.setTargets("janna-savior.enemy-unit-here", [kernel.ref("enemy-here")]);

  const outcome = resolveChainBody(ability.body, productionContext(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["janna-savior.heal-units-here", "executed"],
    ["janna-savior.move-enemy-home", "executed"]
  ]);
  // "here" = the source's Location: only ally-here (and Janna) lose damage.
  assert.equal(kernel.getObject("ally-here").damage, 0);
  assert.equal(kernel.getObject("ally-far").damage, 1);
  const healed = outcome.linkedValues["janna-savior.heal-units-here.healedHere"];
  assert.deepEqual(healed.objects.map((ref) => ref.id).sort(), ["ally-here"]);
  assert.equal(healed.amount, 2);
});

test("sfd-053-221 Janna, Savior golden: the enemy unit here moves to its own base and an enemy elsewhere stays", () => {
  const kernel = boundWorld(jannaWorld());
  kernel.setTargets("janna-savior.enemy-unit-here", [kernel.ref("enemy-here")]);

  const outcome = resolveChainBody(ability.body, productionContext(kernel));

  assert.deepEqual(kernel.getObject("enemy-here").location, { type: "base", player: "B" });
  assert.deepEqual(kernel.getObject("enemy-elsewhere").location, OTHER_BATTLEFIELD);
  assert.deepEqual(outcome.linkedValues["janna-savior.move-enemy-home.movedEnemy"].movements, [
    { object: kernel.ref("enemy-here"), from: BATTLEFIELD, to: { type: "base", player: "B" } }
  ]);
  assert.deepEqual(outcome.events.map((event) => event.action), ["heal", "move-location"]);
});

test("sfd-053-221 Janna, Savior golden: an already undamaged board heals nothing and still moves the enemy", () => {
  const base = world()
    .unit("janna", { might: 3, location: BATTLEFIELD })
    .unit("enemy-here", { might: 2, location: BATTLEFIELD, owner: "B", controller: "B" })
    .build();
  const kernel = boundWorld(base);
  kernel.setTargets("janna-savior.enemy-unit-here", [kernel.ref("enemy-here")]);

  const outcome = resolveChainBody(ability.body, productionContext(kernel));

  // 419.1: a heal with no marked damage produces no action at all; the move still runs.
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.linkedValues["janna-savior.heal-units-here.healedHere"], { amount: 0, count: 0, objects: [] });
  assert.deepEqual(kernel.getObject("enemy-here").location, { type: "base", player: "B" });
  assert.deepEqual(outcome.events.map((event) => event.action), ["move-location"]);
});

test("sfd-053-221 Janna, Savior chain golden: the play trigger heals allies here and moves the enemy home", () => {
  const base = jannaWorld();
  const kernel = base.clone({ source: base.ref("janna"), sourceSnapshot: base.getObject("janna") });
  kernel.setTargets("janna-savior.enemy-unit-here", [kernel.ref("enemy-here")]);
  const answers = [];
  const decide = (request) => {
    answers.push(request);
    if (request.type === "optional") return true;
    if (request.type === "select-objects") return request.options.filter((ref) => ref.id === "enemy-here");
    throw new Error(`unexpected choice ${JSON.stringify(request)}`);
  };
  const contextKernelFor = (source, controller, at) => {
    const scoped = kernel.clone({ source, sourceSnapshot: kernel.getObject(source.id) ?? undefined, controller, timingPoint: at });
    return bindResolveContext(scoped, { choose: (request) => decide({ ...request, scope: "context" }) });
  };
  const host = createActionPipelineHost({
    checkpoint: () => kernel.snapshot(),
    restore: (state) => kernel.restore(state),
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: (request) => decide({ ...request, scope: "host" }),
    context: contextKernelFor,
    testTrigger: () => true
  });
  const engine = new ChainEngine({ turnOrder: ["A", "B"], turnPlayer: "A", phase: "main", host, cleanup: () => false });
  // The executable copy mirrors what production CAN bind today: the heal query
  // keeps its sameLocationAs anchor (it is only consumed by the interpreter's
  // runtime queryObjects), while the move target drops the anchor because
  // translateObjectFilter still rejects it — that dropped anchor is exactly the
  // remaining gap recorded in judgeReason.
  const corrected = {
    ...program,
    status: "executable",
    judgeReason: undefined,
    canonicalCardId: "card:janna",
    abilities: program.abilities.map((entry) => entry.kind !== "triggered" ? entry : {
      ...entry,
      body: entry.body.map((instruction) => instruction.op !== "effect.move" ? instruction : {
        ...instruction,
        targets: instruction.targets.map((target) => {
          const { sameLocationAs: _anchor, ...filter } = target.filter;
          return { ...target, filter };
        })
      })
    })
  };
  const registry = new ProgramRegistry([corrected]);
  attachProgramLifecycle(engine, registry, undefined, () => { /* the move anchor binding error is the documented gap; static binding is not needed for this trigger path */ });
  // The card must be on the battlefield when the play action completes, so the
  // permanent trigger's active zone matches.
  kernel.perform({ type: "move-zone", object: kernel.ref("janna"), to: "hand" });
  engine.commit({ type: "move-zone", object: kernel.ref("janna"), to: "board", location: BATTLEFIELD, player: "A" });
  engine.pipeline.emit({ timingPoint: "card-played", object: kernel.getObject("janna"), player: "A" });
  engine.advance();
  while (engine.items.length) engine.pass(engine.priority);
  assert.deepEqual(kernel.getObject("ally-here").damage, 0);
  assert.equal(kernel.getObject("ally-far").damage, 1);
  assert.deepEqual(kernel.getObject("enemy-here").location, { type: "base", player: "B" });
  assert.deepEqual(kernel.getObject("enemy-elsewhere").location, OTHER_BATTLEFIELD);
  assert.equal(kernel.events.filter((event) => event.action === "heal").length, 1);
});

test.todo(
  "sfd-053-221 Janna, Savior: the card's own binding must accept the 'here' anchor — the merged " +
    "programs/filters.ts translateObjectFilter reports Unsupported filter field sameLocationAs for the heal " +
    "query and the move target, so the TriggerRegistration cannot be installed (RIFT-257 translation surface)"
);

test.todo(
  "sfd-053-221 Janna, Savior: [Reaction]'s continuous.timing permission (813.1.c) reaches the chain's " +
    "actionTimings/canActByRules consumers (P0 contract 3.5) — the keyword expansion must be bound to the " +
    "card program's chain timing before the Closed State play permission can be judged end to end"
);
