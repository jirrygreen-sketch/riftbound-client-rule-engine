// Execution evidence for this card lives in ../templates/keyword-static-671.test.mjs (README 4.1); this
// card stays judge-required for the gaps asserted below.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import program from "../../../dist/cards/sfd/petricite-monument.js";
import temporary from "../../../../engine-core/dist/effects/keywords/Temporary.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
// The production static binder is the path that turns the printed static
// ability into a live layer effect; the golden exercises it directly.
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-40f4f4fa670faf83d3f284bef5c9dc3ae0047668559d38ad02a7521cff81b378";
const SOURCE_TEXT =
  "[Temporary] (Kill this at the start of its controller's Beginning Phase, before scoring.)\n" +
  "Friendly units have [Deflect]. (Opponents must pay :rb_rune_rainbow: to choose them with a spell or ability.)";

test("sfd-104-221 Petricite Monument: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-104-221 Petricite Monument: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-104-221 Petricite Monument: Temporary keyword plus a friendly-unit Deflect grant", () => {
  assert.equal(program.abilities.length, 2);

  // 816.1: the printed [Temporary] is declared as a keyword ability; its
  // expansion (the 816.1.b beginning-start kill) belongs to the keyword registry.
  const [temporary, grant] = program.abilities;
  assert.deepEqual(temporary, { kind: "keyword", keyword: "temporary" });

  // "Friendly units have [Deflect]" — an ongoing grant to units you control.
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "deflect");
  // 809.1.b.3: omitted X is 1.
  assert.deepEqual(grant.effect.value, { kind: "constant", value: 1 });
  assert.deepEqual(grant.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board"
  });
  assert.equal(grant.condition, undefined);
});

test("sfd-104-221 Petricite Monument: Temporary expansion and kill body execute through merged paths", () => {
  const [expanded] = temporary.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(expanded.trigger.at, "beginning-start");
  assert.deepEqual(expanded.trigger.filter, { event: "beginning-start", player: "self" });

  const base = world().unit("petricite-monument", { zone: "board" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("petricite-monument") });
  const outcome = resolveChainBody(expanded.body, kernel);
  assert.equal(outcome.status, "executed");
  assert.equal(kernel.getObject("petricite-monument").zone, "trash");
});

test("sfd-104-221 Petricite Monument golden: the static binder grants [Deflect] to friendly units only", () => {
  // 364.1/364.2 + 809.1.b.3: "Friendly units have [Deflect]" is a continuous
  // grant of Deflect 1 to units the ability's controller controls. The card is
  // still judge-required, so the program is made executable in-memory only for
  // this binder probe; the shipped program and its judgeReason are untouched.
  const executable = { ...program, status: "executable" };
  delete executable.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const { engine, kernel, host } = fixture({
    cards: [
      { id: "petricite", cardId: CARD_ID, types: ["gear"], energy: 2, power: [] },
      { id: "ally", types: ["unit"], might: 2 },
      { id: "enemy", types: ["unit"], might: 2, owner: "B", controller: "B" }
    ]
  });
  const board = id => engine.commit({ type: "move-zone", object: kernel.ref(id), to: "board" });
  board("ally");
  board("enemy");
  const lifecycle = binding.attachLifecycle(engine, () => {});
  board("petricite");
  engine.pipeline.emit({ timingPoint: "object-enters-board", object: kernel.getObject("petricite") });

  assert.deepEqual(engine.layers.evaluate(kernel.ref("ally")).keywords, [
    { id: "deflect", value: 1 }
  ]);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("enemy")).keywords, []);
  lifecycle.detach();
  assert.deepEqual(engine.layers.evaluate(kernel.ref("ally")).keywords, []);
  assert.equal(host.objects().length >= 3, true);
});

test.todo(
  "sfd-104-221 Petricite Monument: [Temporary] (CR 816.1.b) needs the beginning-start event " +
    "name and payload to bind the kill to this permanent through the card-program lifecycle."
);
test.todo(
  "sfd-104-221 Petricite Monument: the granted [Deflect] layer value is live, but the target.tax " +
    "plan mapping from the static binder is still missing, and the merged Finalize tax consumer " +
    "books the tax as Energy instead of any-Domain Power (809.1.c.1)."
);
