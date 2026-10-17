import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import mysticPoro from "../../../dist/cards/ogn/mystic-poro.js";

const CANONICAL =
  "card.hash-85fa951465a6a8b081cd52e0a9b48fd7e3d80cca31309f23efcf0cdf0f302c0e";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { world } = await import(new URL("effects/testing/index.js", engineCore));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", engineCore));
const { createProgramBinding, translateTriggerFilter, triggerRegistrations } = await import(new URL("programs/index.js", engineCore));

test("ogn-171-298 Mystic Poro: program passes validateCardProgram", () => {
  const result = validateCardProgram(mysticPoro);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("ogn-171-298 Mystic Poro: identity, ruleset, status, judgeReason, sourceText", () => {
  assert.equal(mysticPoro.canonicalCardId, CANONICAL);
  assert.equal(mysticPoro.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(mysticPoro.rulesetVersion, "core-1.5");
  assert.equal(mysticPoro.status, "judge-required");
  // judgeReason must name the current production gap (README section 2: no
  // bare "needs support").
  assert.match(mysticPoro.judgeReason, /Vision/);
  // Ordered source infrastructure is merged; the shared Vision expansion
  // still needs filter, source declaration and controller migrations.
  assert.match(mysticPoro.judgeReason, /picksSpecId/);
  assert.match(mysticPoro.judgeReason, /finalizeOrderedPickPlans/);
  assert.match(mysticPoro.judgeReason, /zoneSlice/);
  assert.match(mysticPoro.judgeReason, /Unsupported filter field object\.id/);
  assert.match(mysticPoro.judgeReason, /controller/);
  assert.equal(
    mysticPoro.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)"
  );
});

test("ogn-171-298 Mystic Poro: the only ability is the Vision keyword declaration", () => {
  assert.equal(mysticPoro.abilities.length, 1);
  // A non-valued keyword omits `value` (README section 5; CR 817 carries no number).
  assert.deepEqual(mysticPoro.abilities, [{ kind: "keyword", keyword: "vision" }]);
});

test("ogn-171-298 Mystic Poro: declared keyword resolves to the merged Vision definition (RIFT-83)", () => {
  const [declaration] = mysticPoro.abilities;
  const definition = keywordDefinitionsById.get("Vision");
  assert.ok(definition, "keywords/Vision.ts must be registered for this declaration");
  assert.equal(definition.valued, false);
  assert.equal(definition.stacking, "separate");

  // The expansion of THIS card's declaration must be valid EffectIR v2.
  const expansion = definition.expand({
    value: declaration.value,
    host: { canonicalCardId: CANONICAL }
  });
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: expansion,
    sourceText: mysticPoro.sourceText
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);

  // CR 817.1.c: the trigger is the permanent entering the Board.
  const [ability] = expansion;
  assert.equal(ability.kind, "triggered");
  assert.equal(ability.trigger.at, "object-enters-board");
  assert.equal(ability.optional, false);
});

test("ogn-171-298 Mystic Poro: production binding keeps the unmigrated Vision trigger judge-required for either controller", () => {
  const binding = createProgramBinding({ cardPrograms: [mysticPoro] });
  for (const controller of ["A", "B"]) {
    const kernel = world()
      .base("poro", { cardId: CANONICAL, owner: "A", controller, might: 1 })
      .build();
    const source = kernel.getObject("poro");
    // inspect uses the production keyword expander without bypassing the
    // program's judge-required guard or changing its abilities for the test.
    const inspection = binding.inspect(source);
    assert.equal(inspection.program.status, "judge-required");
    const triggered = inspection.abilities.filter(ability => ability.kind === "triggered");
    assert.equal(triggered.length, 1);
    assert.equal(triggered[0].trigger.at, "object-enters-board");
    assert.throws(
      () => translateTriggerFilter(triggered[0].trigger.filter, source.ref.id, triggered[0].trigger.at),
      { name: "ProgramBindingError", code: "judge-required", message: "Unsupported filter field object.id" }
    );
    // The normal registry must continue refusing execution of the whole card.
    assert.throws(
      () => triggerRegistrations(binding.registry, source),
      { name: "ProgramBindingError", code: "judge-required", message: mysticPoro.judgeReason }
    );
  }
});

test.todo(
  "Mystic Poro: migrate Vision's self-entry filter, declare vision-top with " +
    "picks.zoneSlice for the merged Finalize path, and bind inspect.player to " +
    "the actual controller, so both players can Predict without setPicks"
);

test.todo(
  "Mystic Poro: CR 817.2 stacking — two Vision instances trigger separately and each may recycle independently " +
    "(keywords/Vision.ts declares stacking \"separate\"; execution depends on the " +
    "Vision filter/source/controller migration)"
);

test("ogn-171-298 Mystic Poro: the merged Vision expansion executes look-and-maybe-recycle with ordered picks", () => {
  // The merged KeywordDef expands to effect.inspect + effect.recycle; with the
  // ordered top-card pick supplied by the caller the Predict body runs against
  // the reference kernel. The production chain can now supply declared sources;
  // Vision still needs the migration recorded in judgeReason. This remains
  // execution evidence for the supported sub-effects only.
  const definition = keywordDefinitionsById.get("Vision");
  assert.ok(definition, "Vision must be registered in the keyword registry");
  const [expansion] = definition.expand({ host: { canonicalCardId: CANONICAL } });

  const recycling = world().deck(["top", "second"], { owner: "A" }).build();
  const [topRef] = recycling.zoneSlice("A", "deck", "top", 1).map(object => object.ref);
  recycling.setPicks("vision-top", [topRef]);
  recycling.setAnswers({ "vision-look/effect.inspect%3Aselect%3AA%3AA%3Adeck": [topRef] });
  const recycled = resolveChainBody(expansion.body, recycling);
  assert.equal(recycled.status, "executed");
  assert.deepEqual(
    recycled.results.map(result => [result.id, result.result.status]),
    [["vision-look", "executed"], ["vision-recycle", "executed"]]
  );
  assert.deepEqual(recycling.zoneSlice("A", "deck", "top").map(object => object.ref.id), ["second", "top"]);
  assert.equal(
    recycled.results[1].result.linkedValues.recycledCount,
    1
  );

  const keeping = world().deck(["top", "second"], { owner: "A" }).build();
  const [keptRef] = keeping.zoneSlice("A", "deck", "top", 1).map(object => object.ref);
  keeping.setPicks("vision-top", [keptRef]);
  keeping.setAnswers({ "vision-look/effect.inspect%3Aselect%3AA%3AA%3Adeck": [] });
  const kept = resolveChainBody(expansion.body, keeping);
  assert.equal(kept.status, "executed");
  assert.deepEqual(keeping.zoneSlice("A", "deck", "top").map(object => object.ref.id), ["top", "second"]);
  assert.equal(kept.results[1].result.linkedValues.recycledCount, 0);
});
