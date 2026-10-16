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
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { default: inspect } = await import(new URL("effects/instructions/effect.inspect.js", engineCore));
const { resolveChainBody } = await import(new URL("chain/interpreter-adapter.js", engineCore));
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", engineCore));

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
  // judgeReason must name the missing engine pieces and the dependent tasks
  // (README section 2: no bare "needs support").
  assert.match(mysticPoro.judgeReason, /Vision/);
  // Re-sweep: the Vision KeywordDef is merged (RIFT-83); the remaining gaps
  // are the keyword/trigger binding (RIFT-257) and the ordered top-card path.
  assert.match(mysticPoro.judgeReason, /RIFT-257/);
  assert.match(mysticPoro.judgeReason, /picksSpecId/);
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

test.todo(
  "Mystic Poro: the production top-card path — effect.inspect negates in top scope without an ordered " +
    "picks source (契约 3.6 zoneSlice is not consumed by inspect; only the test kernel's setPicks " +
    "provides one) and no kernel path expands card keyword abilities into an object-enters-board " +
    "trigger on the chain (契约 3.5; RIFT-257)"
);

test.todo(
  "Mystic Poro: CR 817.2 stacking — two Vision instances trigger separately and each may recycle independently " +
    "(keywords/Vision.ts declares stacking \"separate\"; execution depends on the keyword -> trigger " +
    "binding, RIFT-257)"
);

test("ogn-171-298 Mystic Poro: the merged Vision expansion executes look-and-maybe-recycle with ordered picks", () => {
  // The merged KeywordDef expands to effect.inspect + effect.recycle; with the
  // ordered top-card pick supplied by the caller (the production binding gap
  // recorded in judgeReason) the whole Predict body runs against the reference
  // kernel. This is execution evidence for the merged half of the card.
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

test("ogn-171-298 Mystic Poro: without an ordered picks source the production top scope refuses to guess (negative evidence)", () => {
  // Locked evidence for the judgeReason: effect.inspect in top scope without
  // an ordered picksSpecId is negated with reason impossible instead of
  // inferring the deck top from an unordered query.
  const kernel = world().deck(["top"], { owner: "A" }).build();
  const run = runInstruction(
    inspect,
    {
      player: { kind: "literal", value: "A" },
      zone: { kind: "literal", value: "deck" },
      scope: { kind: "literal", value: "top" },
      amount: { kind: "literal", value: 1 },
      choose: { kind: "literal", value: true },
      chooseCount: { kind: "literal", value: { min: 0, max: 1 } }
    },
    { world: kernel }
  );
  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.deepEqual(kernel.zoneSlice("A", "deck", "top").map(object => object.ref.id), ["top"]);
});
