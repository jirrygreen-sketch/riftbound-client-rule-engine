import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/janna-savior.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
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
 * Emulates the production query path for the goldens below: the chain's query
 * wrapper binds the controller placeholder (chain/engine.ts normalizes "self")
 * and asks the layers filter for the rest. The merged program binding
 * (RIFT-257) rejects the sameLocationAs anchor before this point (see
 * judgeReason), so the anchor comparison is performed here for the golden
 * scenario; this proves the effect bodies, not the binding of the anchor.
 */
function productionContext(kernel) {
  const query = (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "self" || normalized[key] === "controller") normalized[key] = kernel.controller;
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === kernel.controller) return false;
      }
      const resolved = { ...normalized };
      if (resolved.controller === "opponent") resolved.controller = "any";
      if (resolved.sameLocationAs === "self" || resolved.sameLocationAs === "source") {
        resolved.location = kernel.source.location?.type ?? null;
        delete resolved.sameLocationAs;
      }
      return matchesObjectFilter(resolved, object);
    });
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
  assert.match(program.judgeReason, /canAct/);
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
        controller: "controller",
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

test.todo(
  "sfd-053-221 Janna, Savior: the card's own binding must accept the 'here' anchor — the merged " +
    "programs/filters.ts translateObjectFilter reports Unsupported filter field sameLocationAs for the heal " +
    "query and the move target, so the TriggerRegistration cannot be installed (RIFT-257 translation surface)"
);

test.todo(
  "sfd-053-221 Janna, Savior: [Reaction]'s continuous.timing permission (813.1.c) must be consumed by the " +
    "chain's canAct query (P0 contract 3.5) — chain/engine.ts canAct still decides from the passed speed alone"
);
