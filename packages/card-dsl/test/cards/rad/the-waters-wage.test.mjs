import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/the-waters-wage.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

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
  assert.match(program.judgeReason, /RIFT-9/);
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

test("The Waters' Wage golden: the Gold token block is real, not approximated", () => {
  const kernel = world().player("A").build();
  // The card's location is the printed "controller" base placeholder, which the
  // Finalize/cost pipeline resolves; the reference kernel resolves bases by
  // player id, so the golden substitutes the concrete controller base.
  const run = runInstruction(
    token,
    {
      token: oneGold.args.token,
      amount: oneGold.args.amount,
      mode: oneGold.args.mode,
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.token.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.query({}).length, 0);
});

test("The Waters' Wage golden: the unsupported exhausted entry override is rejected by effect.token", () => {
  const kernel = world().player("A").build();
  // The merged effect.token schema only accepts token/amount/mode/location/target/
  // pick/locations/choiceId/linkKey; an entry override such as entersExhausted
  // throws rather than silently creating a ready token.
  assert.throws(
    () => runInstruction(
      token,
      {
        token: oneGold.args.token,
        amount: oneGold.args.amount,
        mode: oneGold.args.mode,
        location: oneGold.args.location,
        entersExhausted: oneGold.args.entersExhausted
      },
      { world: kernel }
    ),
    /Invalid effect\.token argument: entersExhausted/
  );
  assert.equal(kernel.query({}).length, 0);
});

test.todo(
  "The Waters' Wage: the Gold gear token definition (CR 187.5 with its own '[Reaction][>] Kill this, " +
    "[E]: [Add] [A]' ability) must be added to effect.token before the token clause can execute — RIFT-9"
);

test.todo(
  "The Waters' Wage: 'play … exhausted' / 'three ready Gold' need the entry-state override (CR 143.4 / 185.2.d) " +
    "that effect.token explicitly does not support"
);

test.todo(
  "The Waters' Wage: 'If it's your turn and you played this from face down' needs an executable predicate for the " +
    "facedown play result (CR 811.1.d) and the current turn player — RIFT-84 / RIFT-90"
);
