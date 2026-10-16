import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/rousing-display.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-e1dc41d23789b8f4890d5cd59e5dc7e12c0c0d447b2f09fd7acf63729930c55d";
const SOURCE_TEXT =
  "[Show Off] a card with Energy cost :rb_energy_7: or more. (As you play this, you may reveal such a card " +
  "from hand or pick a friendly one.)\nPlay two 1 :rb_might: Recruit unit tokens to your base. " +
  "If you showed off, play four to your base instead.disa";

const [keyword, play] = program.abilities;
const [mode] = play.body;
const [fourRecruits] = mode.args.modes.value[0].body;
const [twoRecruits] = mode.args.modes.value[1].body;

test("Rousing Display program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Rousing Display identity, ruleset, status and printed text (including the catalog tail)", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /Show Off/);
  assert.match(program.judgeReason, /RIFT-9/);
  assert.match(program.judgeReason, /RIFT-89/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The catalog's trailing "disa" is preserved verbatim (data issue reported
  // in the task reply; card-data must not be edited here).
  assert.equal(program.sourceText.endsWith("instead.disa"), true);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("Rousing Display structure: [Show Off] plus the exclusive two/four Recruit modes", () => {
  assert.deepEqual(keyword, { kind: "keyword", keyword: "show-off" });
  assert.equal(keyword.value, undefined);
  assert.equal(play.kind, "play");
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 5 }
  });

  assert.equal(mode.op, "choice.mode");
  assert.deepEqual(mode.args.count, { kind: "constant", value: 1 });
  assert.deepEqual(mode.args.different, { kind: "constant", value: true });
  assert.deepEqual(
    mode.args.modes.value.map((entry) => entry.id),
    ["rousing-display-showed-off", "rousing-display-not-showed-off"]
  );
  assert.equal(mode.linkedTo, undefined);
  assert.equal(mode.args.modes.value[0].body.length, 1);
  assert.equal(mode.args.modes.value[1].body.length, 1);

  // Recruit is CR 187.1 (1 Might, Recruit tag); "play … to your base" uses the
  // chain-create + play handoff (440.2.c / 185.2.a).
  assert.equal(fourRecruits.op, "effect.token");
  assert.deepEqual(fourRecruits.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(fourRecruits.args.amount, { kind: "constant", value: 4 });
  assert.deepEqual(fourRecruits.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(twoRecruits.args.amount, { kind: "constant", value: 2 });
  assert.deepEqual(twoRecruits.args.mode, { kind: "constant", value: "play" });
  assert.equal(twoRecruits.linkedTo, undefined);
});

test("Rousing Display golden: playing two Recruit tokens puts two 1 Might Recruits in the controller's base", () => {
  const kernel = world().player("A").build();
  const base = { type: "base", player: "A" };
  const run = runInstruction(
    token,
    {
      token: twoRecruits.args.token,
      amount: twoRecruits.args.amount,
      mode: twoRecruits.args.mode,
      // The printed "to your base" placeholder resolves to the controller's base
      // during Finalize; the reference kernel resolves bases by player id.
      location: { kind: "constant", value: base },
      linkKey: { kind: "constant", value: "recruitTokens" }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const recruits = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(recruits.length, 2);
  for (const recruit of recruits) {
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.tags, ["Recruit"]);
    assert.deepEqual(recruit.location, base);
    assert.equal(recruit.controller, "A");
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
  }
  assert.equal(run.linked["recruitTokens.amount"], 2);
  assert.deepEqual(run.events.map((event) => event.action), ["create-token", "play", "create-token", "play"]);
});

test.todo(
  "Rousing Display: [Show Off] 'a card with Energy cost 7 or more' needs the Show Off keyword expansion and its " +
    "locked finalization information (CR 832.1.c / 832.1.d.1, contract 3.4) — RIFT-9 / RIFT-89"
);

test.todo(
  "Rousing Display: 'If you showed off' needs the executable predicate for the finalization result; the two " +
    "choice.mode branches currently record the structure only — RIFT-9 / RIFT-89"
);
