import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/siren-of-the-shallows.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import disarm from "../../../../engine-core/dist/effects/keywords/Disarm.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runAbilityBody } from "../../../../engine-core/dist/effects/interpreter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-62965a5787d4b9aff0b49316615355a97d59939503fd28b217e578ee755f0d63";
const SOURCE_TEXT =
  "[Disarm] (When I attack, give an enemy unit here -1 :rb_might: this turn.)\n" +
  "[Ganking] (I can move from battlefield to battlefield.)";

test("Siren of the Shallows program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Siren of the Shallows identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason must name the missing keyword expansions and their tasks.
  assert.match(program.judgeReason, /Disarm/);
  assert.match(program.judgeReason, /RIFT-267/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Siren of the Shallows structure: [Disarm] and [Ganking] declared, no invented instructions", () => {
  assert.deepEqual(program.abilities, [
    { kind: "keyword", keyword: "disarm" },
    { kind: "keyword", keyword: "ganking" }
  ]);
  // 831.1.c.3: the printed [Disarm] omits X, so the value is presumed 1 by the
  // keyword expansion (README 5: omit value when the keyword carries none here).
  assert.equal(program.abilities[0].value, undefined);
  assert.equal(program.abilities[1].value, undefined);
  // reminder brackets are rule explanations, never separate instructions.
  assert.equal(program.judgeReason.includes("Ganking"), true);
});

test("Siren of the Shallows structure: the declared keywords resolve to the merged expansions", () => {
  // Both KeywordDefs are registered after RIFT-83 (Ganking) and RIFT-267 (Disarm).
  assert.equal(keywordDefinitionsById.get("Ganking"), ganking);
  assert.equal(keywordDefinitionsById.get("Disarm"), disarm);
  const gankingExpansion = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  assert.deepEqual(gankingExpansion.map((ability) => ability.effect.kind), ["continuous.movement"]);
  const disarmExpansion = disarm.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(disarmExpansion.length, 1);
  assert.equal(disarmExpansion[0].kind, "triggered");
  assert.equal(disarmExpansion[0].trigger.at, "attack-declared");
  assert.equal(disarmExpansion[0].body[0].op, "continuous.might");
});

test("Siren of the Shallows execution: the [Disarm] expansion registers -1 Might for an enemy unit here", () => {
  const expansion = disarm.expand({ host: { canonicalCardId: CANONICAL } });
  const kernel = world()
    .unit("siren", { might: 1, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-here", { owner: "B", controller: "B", might: 4, location: { type: "battlefield", id: "bf-1" } })
    .unit("enemy-elsewhere", { owner: "B", controller: "B", might: 4, location: { type: "battlefield", id: "bf-2" } })
    .build();
  const context = kernel.clone({
    source: kernel.ref("siren"),
    sourceSnapshot: kernel.getObject("siren"),
    controller: "A"
  });
  // The finalized target set the production Finalize step would have locked.
  context.setTargets("disarm.enemy-unit", [kernel.ref("enemy-here")]);
  // The chain's query wrapper binds the controller placeholders and the layers
  // filter implements the sameLocationAs anchor; mirror both here rather than
  // weakening the card's filter.
  const query = (filter) => {
    const normalized = { ...filter };
    for (const key of ["controller", "owner"]) {
      if (normalized[key] === "controller") normalized[key] = context.controller;
    }
    return kernel.objects.filter((object) => {
      for (const key of ["controller", "owner"]) {
        if (normalized[key] === "opponent" && object[key] === context.controller) return false;
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
  const bound = bindResolveContext(context, { query });

  const outcome = runAbilityBody(expansion[0].body, bound);

  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["disarm.give-minus-might", "executed"]
  ]);
  assert.equal(context.continuousEffects.length, 1);
  const [registration] = context.continuousEffects;
  assert.equal(registration.effect.effect.kind, "continuous.might");
  assert.equal(registration.effect.effect.amount, -1);
  assert.deepEqual(registration.duration, { type: "end-of-turn" });

  // 831.1.d: the -1 Might really lands on the enemy unit at the same location.
  const enemyHere = context.getObject("enemy-here");
  const engine = createLayerEngine(new Map([[enemyHere.ref.id + ":" + enemyHere.ref.zoneEntryId, enemyHere]]));
  for (const entry of context.continuousEffects) engine.register(entry.effect, entry.duration);
  assert.equal(engine.evaluate(enemyHere.ref).might, 3);
  assert.equal(context.getObject("enemy-elsewhere").might, 4);
  assert.equal(engine.expireAt("turn-end", "A").length, 1);
  assert.equal(engine.evaluate(enemyHere.ref).might, 4);
});

test("Siren of the Shallows execution: the [Ganking] expansion registers a continuous.movement declaration", () => {
  const expansion = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  // The declaration itself is authored by the merged KeywordDef (810.1.b);
  // registering it with the layers is a static binding, so the layer engine
  // receives the effect exactly as the keyword emits it.
  const effect = expansion[0].effect;
  assert.equal(effect.kind, "continuous.movement");
  assert.equal(effect.permission, "battlefield-to-battlefield");
  assert.equal(effect.source, "battlefield");
  assert.equal(effect.destination, "battlefield");
  assert.equal(effect.move, "standard");
  assert.equal(effect.addsPermission, true);
  // 810.2: Ganking is redundant on one object, so the definition never expands
  // into more than one declaration.
  assert.equal(ganking.stacking, "single");
  assert.equal(ganking.valued, false);
});

test.todo(
  "Siren of the Shallows: the [Disarm] attack trigger must fire from a real attack-declared emission — " +
    "no producer emits attack-declared yet (combat/flow.ts blocks the role transaction) and the " +
    "CardProgram -> keyword -> TriggerRegistration binding is RIFT-257"
);

test.todo(
  "Siren of the Shallows: [Ganking] must reach MovementPermissions.canGank — the expansion writes an " +
    "effect.permission string while layers/rules/query.ts reads effect.permission.routes, and the " +
    "card program -> keyword -> layer binding is RIFT-257"
);
