import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/jeweled-colossus.js";

import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-a75119cac76964b2306b7307a1b7afb6e2430ddfb481d73052d03049f0694722";

test("Jeweled Colossus program validates and is judge-required", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Shield/);
  assert.match(program.judgeReason, /814\.1\.b\.3/);
  assert.match(program.judgeReason, /RIFT-358/);
  assert.match(program.judgeReason, /RIFT-359/);
  assert.match(program.judgeReason, /designation/);
  assert.equal(
    program.sourceText,
    "[Vision] (When you play me, look at the top card of your Main Deck. You may recycle it.)\n" +
      "[Shield] (+1 :rb_might: while I'm a defender.)"
  );
});

test("Jeweled Colossus declares exactly the two printed keywords, in printed order", () => {
  assert.equal(program.abilities.length, 2);
  assert.deepEqual(program.abilities[0], { kind: "keyword", keyword: "vision" });
  // Shield is printed without a value, so no `value` is recorded here; the
  // KeywordDef presumes 1 (814.1.b.3).
  assert.deepEqual(program.abilities[1], { kind: "keyword", keyword: "shield" });
  assert.equal(program.abilities[1].value, undefined);
});

test.todo(
  "Jeweled Colossus Shield: read combatRole for the defender condition, then verify +1 only while defending " +
    "through the production static binder (CR 814.1.c-d.1; RIFT-359)"
);
test.todo(
  "Jeweled Colossus Vision: bind the actual controller and ordered vision-top at each trigger resolution (RIFT-358)"
);

for (const recycle of [false, true]) {
  test(`Jeweled Colossus supported Vision body: ${recycle ? "recycle" : "keep"} the actual top card`, () => {
    const kernel = world().unit("colossus", { cardId: CANONICAL }).deck(["z-top", "a-bottom"]).build();
    const binding = createProgramBinding({ cardPrograms: [program] });
    const vision = binding.inspect(kernel.getObject("colossus")).abilities.find(ability => ability.kind === "triggered");
    const [look] = vision.body;
    const top = kernel.zoneSlice("A", "deck", "top", look.args.amount.value).map(object => object.ref);
    // This explicitly provisions the pending ordered-pick boundary; it is
    // evidence for the Predict body, not automatic production Vision binding.
    kernel.setPicks(look.args.picksSpecId.value, top);
    kernel.setAnswers({ ["vision-look/" + encodeURIComponent("effect.inspect:select:A:A:deck")]: recycle ? top : [] });
    const outcome = resolveChainBody(vision.body, kernel);
    assert.equal(outcome.status, "executed");
    assert.deepEqual(outcome.linkedValues["vision-look.vision-picked"], top);
    assert.equal(outcome.linkedValues["vision-recycle.recycledCount"], recycle ? 1 : 0);
    assert.deepEqual(outcome.events.map(event => event.action), recycle ? ["look", "recycle"] : ["look"]);
    assert.deepEqual(kernel.zone("A", "deck").map(ref => ref.id), recycle ? ["a-bottom", "z-top"] : ["z-top", "a-bottom"]);
  });
}
