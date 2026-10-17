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
const unitSpec = countEnemies.targets[0];

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
    assert.equal(countEnemies.targets.length, 1);
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
  // The count is read at resolution (359.3.f.2). Move an enemy out through
  // the kernel after locking the target, rather than building a second world.
  const departed = kernel.ref("enemy-two");
  assert.equal(kernel.perform({ type: "return-to-hand", object: departed }).status, "done");
  assert.equal(kernel.object(departed), null);
  assert.equal(kernel.getObject("enemy-two").zone, "hand");
  const outcome = resolveChainBody(play.body, chainKernel(kernel));
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.linkedValues["against-the-odds.count-enemies.enemyCount"], 2);
  assert.equal(kernel.continuousEffects.length, 1);
  assert.equal(kernel.continuousEffects[0].effect.effect.amount, 2);
  assert.equal(effectiveMight(kernel, "chosen"), 5);
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
  // Lock the target first, then use a real zone-changing action so the old
  // ObjectRef becomes stale before resolution (124 / 359.3.e.6).
  const kernel = world()
    .unit("chosen", { owner: "A", controller: "A", might: 3, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy", { owner: "B", controller: "B", location: { type: "battlefield", id: "bf-1" } })
    .build();
  kernel.setTargets(unitSpec.id, [kernel.ref("chosen")]);
  const stale = kernel.ref("chosen");
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");
  assert.equal(kernel.object(stale), null);
  assert.notEqual(kernel.ref("chosen").zoneEntryId, stale.zoneEntryId);
  assert.deepEqual(kernel.events.map((event) => event.action), ["return-to-hand"]);

  const outcome = resolveChainBody(play.body, chainKernel(kernel));
  assert.equal(outcome.status, "partial");
  assert.deepEqual(
    outcome.results.map((entry) => [entry.id, entry.result.status]),
    [
      ["against-the-odds.count-enemies", "ignored"],
      ["against-the-odds.grant-might", "ignored"]
    ]
  );
  assert.equal(outcome.results[0].result.reason, "mistargeted");
  assert.equal(outcome.results[1].result.reason, "linked-ignored");
  assert.equal(outcome.linkedValues["against-the-odds.count-enemies.enemyCount"], undefined);
  assert.deepEqual(kernel.events.map((event) => event.action), ["return-to-hand"]);
  assert.equal(kernel.continuousEffects.length, 0);
  assert.equal(kernel.getObject("chosen").zone, "hand");
  assert.equal(effectiveMight(kernel, "chosen"), 3);
});
