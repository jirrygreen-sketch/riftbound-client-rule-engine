import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/fiora-victorious.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CANONICAL = "card.hash-184064ceedf3bc8c1c777c425d1bc971c0b7a878cde5573d58da57509cf5d08e";
const [ability] = program.abilities;

test("ogn-232-298 Fiora, Victorious: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-232-298 Fiora, Victorious: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /Shield/);
  assert.equal(
    program.sourceText,
    "While I'm [Mighty], I have [Deflect], [Ganking], and [Shield]. (I'm Mighty while I have 5+ :rb_might:.)"
  );
});

test("ogn-232-298 Fiora, Victorious: one static ability conditionally granting the three keywords", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.grant-keyword");
  assert.equal(ability.effect.appliesTo, "self");
  // CR 809.1.b.3 / 814.1.b.3: omitted values default to 1; CR 810: Ganking has no value.
  assert.deepEqual(ability.effect.keywords, [
    { id: "Deflect", value: 1 },
    { id: "Ganking" },
    { id: "Shield", value: 1 }
  ]);
});

test("ogn-232-298 Fiora, Victorious: the grant is gated on the Might >= 5 Mighty description", () => {
  // CR 708/710: a unit is Mighty while its current Might is 5 or greater.
  assert.deepEqual(ability.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "might" },
    operator: "gte",
    right: { kind: "constant", value: 5 }
  });
});

test("ogn-232-298 Fiora, Victorious: the declared condition evaluates on the reference kernel at the Mighty threshold", () => {
  for (const [might, expected] of [[4, false], [5, true]]) {
    const kernel = world().unit("fiora", { might }).build();
    const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("fiora") });
    assert.equal(scoped.test(ability.condition), expected, "Mighty at Might " + might);
  }
});

test("Fiora's original static grant binds to layers at the Mighty threshold", () => {
  for (const might of [4, 5]) {
    const f = fixture({ cards: [{ id: "fiora", cardId: CANONICAL, types: ["unit"], might }] });
    f.engine.commit({ type: "move-zone", object: f.kernel.ref("fiora"), to: "base", location: { type: "base", player: "A" } });
    f.engine.advance();
    // Bind only the supported static ability, preserving the full program's
    // judge-required guard for the unimplemented granted-keyword behaviors.
    const handle = createEngineStaticBinder(f.engine).bindStatic(ability, f.kernel.getObject("fiora"));
    assert.deepEqual(f.engine.layers.snapshot(f.kernel.ref("fiora")).keywords,
      might === 5 ? [{ id: "Deflect", value: 1 }, { id: "Ganking", value: undefined }, { id: "Shield", value: 1 }] : []);
    assert.deepEqual(f.kernel.getObject("fiora").keywords, [], "grant comes from layers");
    assert.deepEqual(f.engine.layers.snapshot(f.kernel.ref("source")).keywords, [], "grant applies only to Fiora");
    handle.unbind();
    assert.deepEqual(f.engine.layers.snapshot(f.kernel.ref("fiora")).keywords, []);
  }
});

test("ogn-232-298 Fiora, Victorious: the three granted KeywordDefs expand to their current effect shapes", () => {
  const host = { canonicalCardId: CANONICAL };
  const deflect = keywordDefinitionsById.get("Deflect");
  const ganking = keywordDefinitionsById.get("Ganking");
  const shield = keywordDefinitionsById.get("Shield");
  assert.ok(deflect);
  assert.ok(ganking);
  assert.ok(shield);

  assert.equal(deflect.expand({ value: 1, host })[0].effect.kind, "target.tax");
  assert.equal(ganking.expand({ host })[0].effect.kind, "continuous.movement");
  assert.equal(shield.expand({ value: 1, host })[0].effect.kind, "continuous.might");
});

test.todo("Fiora, Victorious: expand conditional keyword grants into live Ganking/Shield behaviors and effective-Might checks, and connect Deflect target costs to Finalize (CR 708/710, 809.1.c, 810.1.b, 814.1.c)");
