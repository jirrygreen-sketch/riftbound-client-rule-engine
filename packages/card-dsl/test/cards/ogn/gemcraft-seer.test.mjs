import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/gemcraft-seer.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-636736b78f865097117f9cc183f462f662d5b234a87f487fd261ac54279875c6";

test("Gemcraft Seer program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /静态 grant/);
  assert.match(program.judgeReason, /object\.id/);
  assert.match(program.judgeReason, /exclude:self/);
  assert.equal(
    program.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
      "Other friendly units have [Vision]."
  );
});

test("Gemcraft Seer structure: Vision keyword plus an other-friendly-units Vision grant", () => {
  assert.equal(program.abilities.length, 2);
  const [keyword, staticAbility] = program.abilities;
  assert.deepEqual(keyword, { kind: "keyword", keyword: "vision" });

  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.grant-keyword");
  assert.equal(staticAbility.effect.keyword, "Vision");
  assert.equal(staticAbility.condition, undefined);
  // "Other friendly units": units the controller controls, on the board, with
  // the source itself excluded ("other").
  assert.deepEqual(staticAbility.effect.filter, {
    type: "unit",
    controller: "controller",
    zone: "board",
    exclude: "self"
  });
});

for (const recycle of [false, true]) {
  test(`Gemcraft Seer supported Vision body: ${recycle ? "recycle" : "keep"} the actual top card`, () => {
    const kernel = world().unit("seer", { cardId: CANONICAL }).deck(["top-card", "next-card"]).build();
    const binding = createProgramBinding({ cardPrograms: [program] });
    const vision = binding.inspect(kernel.getObject("seer")).abilities.find(ability => ability.kind === "triggered");
    const [look] = vision.body;
    const top = kernel.zoneSlice("A", "deck", "top", look.args.amount.value).map(object => object.ref);
    kernel.setPicks(look.args.picksSpecId.value, top);
    kernel.setAnswers({ ["vision-look/" + encodeURIComponent("effect.inspect:select:A:A:deck")]: recycle ? top : [] });

    const outcome = resolveChainBody(vision.body, kernel);

    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues["vision-look.vision-picked"], top);
    assert.equal(outcome.linkedValues["vision-recycle.recycledCount"], recycle ? 1 : 0);
    assert.deepEqual(outcome.events.map(event => event.action), recycle ? ["look", "recycle"] : ["look"]);
    assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), recycle ? ["next-card", "top-card"] : ["top-card", "next-card"]);
  });
}
