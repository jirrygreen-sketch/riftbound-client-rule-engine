import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/against-the-odds.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-ce4f294fc93a34896d001feda8ba9d15d051f2ea01bf0c84a56036243102b3fa";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "Give a friendly unit at a battlefield +2 :rb_might: this turn for each enemy unit there.";

const [, play] = program.abilities;
const [countEnemies, grantMight] = play.body;
const unitSpec = grantMight.targets[0];

/**
 * The resolving effect's own registrations, shaped for the real layer engine.
 * Distinct resolution passes carry distinct settlement identities, but the
 * reference kernel records entries without identities; pass the index as the
 * engine timestamp so each entry keeps a distinct registration identity.
 */
const registrations = (kernel) =>
  kernel.continuousEffects.map((entry, index) => ({ effect: entry.effect, duration: entry.duration, timestamp: index + 1 }));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

/**
 * The reference kernel compares filter values literally, while the chain's
 * query path (chain/engine.ts) normalizes "self"/"opponent" against the ability
 * controller and layers/filter.ts matches the scalar "battlefield" location key
 * against location.type. Reproduce that normalization so the card's own filter
 * shape executes (same convention as the merged sfd/deathgrip golden).
 */
function chainKernel(kernel, controller = "A") {
  return new Proxy(kernel, {
    get(target, key) {
      if (key === "query") {
        return (filter) => {
          const normalized = { ...filter };
          const kernelFilter = { ...normalized };
          const opponents = [];
          for (const playerKey of ["controller", "owner"]) {
            if (normalized[playerKey] === "self") kernelFilter[playerKey] = controller;
            else if (normalized[playerKey] === "opponent") {
              delete kernelFilter[playerKey];
              opponents.push(playerKey);
            }
          }
          let battlefield;
          if (normalized.location !== undefined) {
            battlefield = normalized.location;
            delete kernelFilter.location;
          }
          return target
            .query(kernelFilter)
            .filter((object) => {
              if (opponents.some((playerKey) => object[playerKey] === controller)) return false;
              if (battlefield !== undefined && object.location?.type !== battlefield) return false;
              return true;
            });
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-001-221 Against the Odds: program is valid EffectIR v2 data and executable", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test(
  "sfd-001-221 Against the Odds structure: [Reaction], battlefield-unit target and the " +
    "two-step +2 x enemy count grant",
  () => {
    assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "reaction" });
    assert.equal(play.kind, "play");
    // Catalog printed cost: 2 energy, no printed Power (never rewritten as 0).
    assert.deepEqual(play.cost, {
      kind: "cost.printed",
      energy: { kind: "constant", value: 2 }
    });
    assert.deepEqual(
      play.body.map((instruction) => [instruction.id, instruction.op]),
      [
        ["against-the-odds.count-enemies", "condition.value"],
        ["against-the-odds.grant-might", "continuous.might"]
      ]
    );

    // "+2 Might this turn for each enemy unit there": the amount is the merged
    // arithmetic 2 x (enemy units at the chosen unit's location), read through
    // a condition.value instruction so the grant consumes an evaluated integer.
    assert.deepEqual(countEnemies.args, {
      operands: {
        kind: "constant",
        value: [
          { kind: "constant", value: 2 },
          {
            kind: "count",
            subject: "enemy-units-at-the-chosen-unit",
            filter: {
              type: "unit",
              controller: "opponent",
              sameLocationAs: { target: "against-the-odds.unit" }
            }
          }
        ]
      },
      operator: { kind: "constant", value: "multiply" },
      key: { kind: "constant", value: "enemyCount" }
    });

    // "a friendly unit at a battlefield": one controlled Board unit at a
    // battlefield (355.10.b: the battlefield itself is not a target, so the
    // restriction is the merged location filter key, not a second target).
    assert.equal(grantMight.linkedTo, "against-the-odds.count-enemies");
    assert.deepEqual(grantMight.args.objects, {
      kind: "constant",
      value: { kind: "target", id: "against-the-odds.unit" }
    });
    assert.deepEqual(grantMight.args.amount, {
      kind: "linked-value",
      instructionId: "against-the-odds.count-enemies",
      key: "enemyCount"
    });
    assert.deepEqual(grantMight.args.duration, { kind: "constant", value: "this-turn" });
    assert.equal(grantMight.targets.length, 1);
    assert.equal(unitSpec.id, "against-the-odds.unit");
    assert.deepEqual(unitSpec.filter, { type: "unit", controller: "self", location: "battlefield" });
    assert.equal(unitSpec.min, 1);
    assert.equal(unitSpec.max, 1);
    assert.equal(unitSpec.selection, "one");
  }
);

test("sfd-001-221 Against the Odds golden: grants +2 per enemy unit there and expires at cleanup", () => {
  const kernel = world()
    .unit("chosen", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-one", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-two", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("chosen")]);

  const outcome = resolveChainBody(play.body, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["against-the-odds.count-enemies", "executed"],
      ["against-the-odds.grant-might", "executed"]
    ]
  );
  // Two enemy units sit at the chosen unit's battlefield, the third at another:
  // "+2 Might for each enemy unit there" is +4 (359.3.f.2 read at resolution).
  assert.equal(outcome.linkedValues["against-the-odds.count-enemies.enemyCount"], 4);
  assert.equal(kernel.continuousEffects.length, 1);
  const [registration] = kernel.continuousEffects;
  assert.equal(registration.effect.layer, "arithmetic");
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, 4);
  assert.equal(registration.effect.filter.objectId, "chosen");
  assert.deepEqual(registration.duration, { type: "end-of-turn" });
  assert.equal(effectiveMight(kernel, "chosen"), 7);
  // 317.2.c: "this turn" expires in the end-of-turn cleanup.
  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.expireAt("turn-end").length, 1);
  assert.equal(engine.evaluate(kernel.ref("chosen")).might, 3);
});

test("sfd-001-221 Against the Odds golden: an enemy that left the battlefield stops counting", () => {
  const kernel = world()
    .unit("chosen", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-one", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-two", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("chosen")]);
  const before = resolveChainBody(play.body, chainKernel(kernel));
  assert.equal(before.linkedValues["against-the-odds.count-enemies.enemyCount"], 4);

  // The count is re-read at resolution, so the state when the effect resolves
  // decides the amount (359.3.f.2). The reference kernel stores registrations
  // without settlement identities, so the second pass is asserted on its own
  // kernel instead of accumulating a duplicate id on the first kernel.
  const movedKernel = world()
    .unit("chosen", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-one", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-two", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  movedKernel.setTargets(unitSpec.id, [movedKernel.ref("chosen")]);
  const outcome = resolveChainBody(play.body, chainKernel(movedKernel));
  assert.equal(outcome.linkedValues["against-the-odds.count-enemies.enemyCount"], 2);
  assert.equal(movedKernel.continuousEffects.length, 1);
  assert.equal(movedKernel.continuousEffects[0].effect.effect.amount, 2);
  assert.equal(effectiveMight(movedKernel, "chosen"), 5);
});

test("sfd-001-221 Against the Odds golden: no enemy unit there means no modification", () => {
  // With zero enemy units at the chosen unit's battlefield the computed amount
  // is 0; the merged primitive does not register a +0 modification and the
  // instruction is negated (skipped) instead.
  const kernel = world()
    .unit("chosen", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-2" } })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("chosen")]);

  const outcome = resolveChainBody(play.body, chainKernel(kernel));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["against-the-odds.count-enemies", "executed"],
      ["against-the-odds.grant-might", "negated"]
    ]
  );
  assert.equal(outcome.results[1].result.reason, "skipped");
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(effectiveMight(kernel, "chosen"), 3);
});

test("sfd-001-221 Against the Odds golden: a chosen unit off the battlefield is not a legal target", () => {
  // "at a battlefield" restricts the target: a friendly unit moved away fails
  // the target lock and the whole grant is ignored (359.3.e.6).
  const kernel = world()
    .unit("chosen", { owner: "A", controller: "A", might: 3, zone: "hand", location: null })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("chosen")]);

  const outcome = resolveChainBody(play.body, chainKernel(kernel));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["against-the-odds.count-enemies", "executed"],
      // The grant's objects resolve to zero Board references, so the merged
      // primitive negates instead of registering (resolveCandidates -> ignored,
      // surfaced as the interpreter's negated result for this instruction).
      ["against-the-odds.grant-might", "negated"]
    ]
  );
  assert.equal(kernel.continuousEffects.length, 0);
  // The chosen unit is in its owner's hand, so the layer engine no longer
  // evaluates it as a Board object (the hand snapshot keeps the printed might).
  assert.equal(effectiveMight(kernel, "chosen"), 3);
});
