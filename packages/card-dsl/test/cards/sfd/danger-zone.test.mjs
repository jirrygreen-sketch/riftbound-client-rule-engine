import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import dangerZone from "../../../dist/cards/sfd/danger-zone.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-3c1c01b405853556e3e1c12bbd758e94d73f5ed474a5643bb068eaa7cb549c6e";
const SOURCE_TEXT =
  "[Reaction] (Play any time, even before spells and abilities resolve.)\n" +
  "[Repeat] :rb_energy_1::rb_rune_rainbow: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Give your Mechs +1 :rb_might: this turn.";

const [speed, play] = dangerZone.abilities;
const buff = play.body[0];

/** The resolving effect's own registrations, shaped for the real layer engine. */
const registrations = (kernel) =>
  kernel.continuousEffects.map((entry) => ({ effect: entry.effect, duration: entry.duration, timestamp: 1 }));

const effectiveMight = (kernel, id) =>
  createLayerEngine(kernel.objects, registrations(kernel)).evaluate(kernel.ref(id)).might;

/**
 * The reference kernel compares filter values literally, while the card layer
 * spells "your Mechs" as controller: "self" and the chain's query path
 * (chain/engine.ts) normalizes self/opponent against the ability controller.
 * Reproduce that normalization so the card's own query shape executes (same
 * convention as the merged sfd/on-the-hunt golden).
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
          return target
            .query(kernelFilter)
            .filter((object) => opponents.every((playerKey) => object[playerKey] !== controller));
        };
      }
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("sfd-182-221 Danger Zone: program is structurally valid and judge-required", () => {
  const result = validateCardProgram(dangerZone);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(dangerZone.canonicalCardId, CARD_ID);
  assert.equal(dangerZone.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(dangerZone.status, "judge-required");
  assert.equal(dangerZone.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), dangerZone);
});

test("sfd-182-221 Danger Zone: judgeReason names the current Repeat cost gap", () => {
  assert.match(dangerZone.judgeReason, /Repeat/);
  assert.match(dangerZone.judgeReason, /translateCost/);
  assert.match(dangerZone.judgeReason, /Additional costs are not bound/);
  assert.match(dangerZone.judgeReason, /repeat\.cost/);
  assert.match(dangerZone.judgeReason, /continuous\.might/);
  assert.doesNotMatch(dangerZone.judgeReason, /RIFT-261|RIFT-257|RIFT-258/);
  assert.equal(keywordDefinitionsById.has("Repeat"), true);
  // The old description claimed the Repeat KeywordDef itself was missing;
  // it merged long ago, so the reason must not still say so.
  assert.doesNotMatch(dangerZone.judgeReason, /无已合入 KeywordDef/);
});

test("sfd-182-221 Danger Zone ability structure: [Reaction] + play with Repeat additional cost", () => {
  assert.equal(dangerZone.abilities.length, 2);

  assert.deepEqual(speed, { kind: "keyword", keyword: "reaction" });
  assert.equal(play.kind, "play");

  // [Repeat] 1 energy + 1 rainbow rune: declared as an additional cost on
  // the play ability (contract 3.1 CostSpec). The Repeat KeywordDef
  // is merged, but the play flow still has no additional-cost consumer.
  assert.equal(play.cost.kind, "additional-cost");
  assert.equal(play.cost.keyword, "repeat");
  assert.deepEqual(play.cost.energy, { kind: "literal", value: 1 });
  assert.deepEqual(play.cost.power, { kind: "literal", value: ["rainbow"] });

  // "Give your Mechs +1 Might this turn" is an each-set, NOT a target
  // (v1.5 355.7 / 355.10.d), so the instruction carries no TargetSpec.
  assert.equal(play.body.length, 1);
  assert.equal(buff.id, "buff-mechs");
  assert.equal(buff.op, "continuous.might");
  assert.equal(instructionDefinitionsById.has("continuous.might"), true);
  assert.equal(buff.targets, undefined);
  assert.equal(buff.picks, undefined);
  assert.deepEqual(buff.args.amount, { kind: "literal", value: 1 });
  assert.deepEqual(buff.args.duration, { kind: "literal", value: "this-turn" });
  assert.deepEqual(buff.args.objects, {
    kind: "literal",
    value: {
      kind: "query",
      filter: { type: "unit", tags: ["Mech"], controller: "self", zone: "board" }
    }
  });
});

test("sfd-182-221 Danger Zone golden: each friendly Mech gets +1 Might this turn", () => {
  const kernel = world()
    .unit("mech-a", { owner: "A", controller: "A", tags: ["Mech"], might: 2 })
    .unit("mech-b", { owner: "A", controller: "A", tags: ["Mech"], might: 4 })
    .unit("enemy-mech", { owner: "B", controller: "B", tags: ["Mech"], might: 2 })
    .unit("grunt", { owner: "A", controller: "A", might: 2 })
    .build();

  const outcome = resolveChainBody(play.body, chainKernel(kernel));

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((entry) => [entry.id, entry.result.status]), [
    ["buff-mechs", "executed"]
  ]);
  // One arithmetic-layer registration per friendly Mech (355.10.d set), with
  // the end-of-turn duration; the enemy Mech and the non-Mech are untouched.
  assert.equal(kernel.continuousEffects.length, 2);
  assert.deepEqual(
    kernel.continuousEffects.map((entry) => entry.effect.filter.objectId).sort(),
    ["mech-a", "mech-b"]
  );
  for (const entry of kernel.continuousEffects) {
    assert.equal(entry.effect.layer, "arithmetic");
    assert.equal(entry.effect.effect.kind, "continuous.might");
    assert.equal(entry.effect.effect.amount, 1);
    assert.deepEqual(entry.duration, { type: "end-of-turn" });
  }
  assert.equal(effectiveMight(kernel, "mech-a"), 3);
  assert.equal(effectiveMight(kernel, "mech-b"), 5);
  assert.equal(effectiveMight(kernel, "enemy-mech"), 2);
  assert.equal(effectiveMight(kernel, "grunt"), 2);
});

test("sfd-182-221 Danger Zone golden: the buff expires at cleanup (317.2.c)", () => {
  const kernel = world()
    .unit("mech-a", { owner: "A", tags: ["Mech"], might: 2 })
    .build();
  resolveChainBody(play.body, chainKernel(kernel));

  const engine = createLayerEngine(kernel.objects, registrations(kernel));
  assert.equal(engine.evaluate(kernel.ref("mech-a")).might, 3);
  const expired = engine.expireAt("turn-end");
  assert.equal(expired.length, 1);
  assert.equal(engine.evaluate(kernel.ref("mech-a")).might, 2);
});

test("sfd-182-221 Danger Zone golden: no friendly Mech produces no registration and a skipped result", () => {
  const kernel = world()
    .unit("grunt", { owner: "A", might: 2 })
    .unit("enemy-mech", { owner: "B", tags: ["Mech"], might: 2 })
    .build();

  const outcome = resolveChainBody(play.body, chainKernel(kernel));
  // The merged primitive documents an empty set as negated/skipped: the set
  // was legal but no object was affected, so nothing is registered.
  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results[0].result, { status: "negated", reason: "skipped", events: [] });
  assert.equal(kernel.continuousEffects.length, 0);
});

test.todo(
  "sfd-182-221 Danger Zone: [Repeat] paying 1 energy + 1 rainbow rune repeats the buff (CR 820.1.c; " +
    "play.ts translateCost currently throws judgeRequired for additional-cost, static repeat.cost " +
    "has no layer/Finalize consumer, and the paid-repeat count is unwired)"
);
