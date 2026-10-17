import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/the-waters-wage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-98b3c6e4016c853f5b0a9bdc4963a2a929fcb2930a1f1484367e5c546015fe0c";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Play a Gold gear token exhausted. If it's your turn and you played this from face down, " +
  "play three ready Gold gear tokens instead. (Gold tokens have \"[Reaction][>] Kill this, " +
  ":rb_exhaust:: [Add] :rb_rune_rainbow:.\")";

const [keyword, play] = program.abilities;
const [mode] = play.body;
const [oneGold] = mode.args.modes.value[0].body;
const [threeGold] = mode.args.modes.value[1].body;

test("The Waters' Wage program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("The Waters' Wage identity, ruleset, status and printed text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /185\.2\.d/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /entry override/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("The Waters' Wage structure: [Hidden] plus the exclusive one/three Gold modes", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "hidden" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 1 }
  });

  assert.equal(mode.op, "choice.mode");
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.deepEqual(
    mode.args.modes.value.map((entry) => entry.id),
    ["the-waters-wage-one", "the-waters-wage-three"]
  );
  // "instead" makes the two branches exclusive: each mode carries exactly one
  // token instruction, and the linkedTo of neither points at the other.
  assert.equal(mode.args.modes.value[0].body.length, 1);
  assert.equal(mode.args.modes.value[1].body.length, 1);
  assert.equal(oneGold.linkedTo, undefined);
  assert.equal(threeGold.linkedTo, undefined);

  // "Play a Gold gear token exhausted": play mode through the chain (440.2.c /
  // 185.2.a) with the printed exhausted entry state (143.4 / 185.2.d).
  assert.equal(oneGold.op, "effect.token");
  assert.deepEqual(oneGold.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(oneGold.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(oneGold.args.mode, { kind: "constant", value: "play" });
  assert.equal(oneGold.args.entersExhausted.value, true);
  assert.deepEqual(threeGold.args.amount, { kind: "constant", value: 3 });
  assert.equal(threeGold.args.entersExhausted.value, false);
});

test.todo(
  "The Waters' Wage: the Gold gear token definition (CR 187.5 with its own '[Reaction][>] Kill this, " +
    "[E]: [Add] [A]' ability) is not in the effect.token DEFINITIONS table, so the token clause cannot be " +
    "executed; a definition table extension must land first"
);

test.todo(
  "The Waters' Wage: 'play … exhausted' / 'three ready Gold' need a per-token entry-state override " +
    "(CR 143.4 / 185.2.d); effect.token has no entry override, and replacement.enter covers permanent entry " +
    "orientation only"
);

test.todo(
  "The Waters' Wage: 'If it's your turn and you played this from face down' needs an executable predicate for the " +
    "facedown play result (CR 811.1.d) and the current turn player. The [Hidden] KeywordDef and cost.hidden are merged, " +
    "but cost/kinds/hidden.ts only locks the Hide plan and payment: hidden-play permission, facedown free-play " +
    "consumption and the next-turn Reaction permission (continuous.timing) are still unwired."
);
