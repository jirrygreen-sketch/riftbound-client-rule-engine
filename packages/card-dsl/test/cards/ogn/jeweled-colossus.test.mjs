import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/jeweled-colossus.js";

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
  assert.match(program.judgeReason, /RIFT-91/);
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
  "Jeweled Colossus [Shield] expansion: +1 [M] while the unit is a defender (814.1.c / 814.1.d.1) through a layers " +
    "continuous.might effect keyed to the defender designation (RIFT-91); no merged ObjectSnapshot characteristic carries the designation"
);

test.todo(
  "Jeweled Colossus [Vision] expansion: Predict 1 at object-enters-board, may recycle the seen card (817.1.c, 437.1 / 437.3.a), " +
    "subscribed through the merged chain trigger registration (effects/keywords/Vision.ts body already executes on the reference kernel)"
);
