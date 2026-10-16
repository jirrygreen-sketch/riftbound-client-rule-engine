import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/twilight-shroud.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-e54ee1b49e982f2d0d89cb2a1ada3688523cfee6c53db33c9aa872c7802ea0df";
const SOURCE_TEXT =
  "Give a friendly unit +1 :rb_might: this turn. It can't be chosen by enemy spells and abilities this turn.\n" +
  "[Flow] :rb_energy_2: (You may play this from your trash for its Flow cost. Then banish it.)";

const [flowKeyword, play] = program.abilities;
const [mightInstruction, restrictInstruction] = play.body;
const [unitSpec] = mightInstruction.targets;

test("ven-031-166 Twilight Shroud: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("ven-031-166 Twilight Shroud: identity, ruleset, status, judgeReason and verbatim text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /355\.9\.b/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-261/);
});

test("ven-031-166 Twilight Shroud: [Flow], the energy-only cost, and the two remaining clauses", () => {
  assert.deepEqual(flowKeyword, { kind: "keyword", keyword: "flow" });
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });
  assert.equal(Object.hasOwn(play.cost, "power"), false);

  // "+1 Might this turn": a temporary Might modification (317.2.c / 143.2.a),
  // never a Buff counter (702/703).
  assert.equal(mightInstruction.id, "twilight-shroud.grant-might");
  assert.equal(mightInstruction.op, "continuous.might");
  assert.deepEqual(mightInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(mightInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(unitSpec, {
    id: "twilight-shroud.friendly-unit",
    filter: { type: "unit", zone: "board", controller: "controller" },
    min: 1,
    max: 1,
    selection: "one"
  });

  // "It can't be chosen by enemy spells and abilities this turn": 355.9.b's own
  // example of a targeting restriction, on the same unit ("it", 359.3.e.14).
  assert.equal(restrictInstruction.id, "twilight-shroud.cannot-be-chosen");
  assert.equal(restrictInstruction.op, "continuous.restrict");
  assert.equal(restrictInstruction.linkedTo, "twilight-shroud.grant-might");
  assert.deepEqual(restrictInstruction.args.restriction, {
    kind: "constant",
    value: "cannot-be-chosen-by-enemy-spells-and-abilities"
  });
  assert.deepEqual(restrictInstruction.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(restrictInstruction.targets, mightInstruction.targets);
});

test.todo(
  "ven-031-166 Twilight Shroud: apply +1 Might until end of turn (317.2.c) through continuous.might — no " +
    "merged instruction registers a duration-bounded Might modification via ResolveContext.addContinuous " +
    "(RIFT-9 inventory; RIFT-91 merged only the layer evaluation side)"
);

test.todo(
  "ven-031-166 Twilight Shroud: enforce \"It can't be chosen by enemy spells and abilities this turn\" " +
    "(355.9.b) — the chain target plan reads no continuous per-object targeting restriction, and " +
    "continuous.restrict has no registered primitive"
);

test.todo(
  "ven-031-166 Twilight Shroud: play from trash for the printed Flow cost (2 energy) then banish it — the " +
    "printed cost cannot reach KeywordDef.expand (contract 3.8.3) and RIFT-261/RIFT-260 consumers are unmerged"
);
