import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/bushwhack.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const CANONICAL = "card.hash-ee775877b722c8156c89940004f522bef67be48c96cbc0ae9175061e38ad6c56";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "Friendly units enter ready this turn. Play a Gold gear token exhausted.";

const [hidden, play] = program.abilities;
const [enterReady, goldToken] = play.body;

test("sfd-004-221 Bushwhack: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-004-221 Bushwhack: judge-required for Hidden, the entry replacement and the Gold token", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /811\.1/);
  assert.match(program.judgeReason, /replacement\.enter/);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /Entry overrides are not supported/);
});

test("sfd-004-221 Bushwhack structure: [Hidden], the entry-ready stipulation and the Gold token", () => {
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });
  assert.equal(play.kind, "play");
  // Catalog printed cost: 2 energy + 1 Fury power.
  assert.deepEqual(play.cost, {
    kind: "cost.printed",
    energy: { kind: "constant", value: 2 },
    power: { kind: "constant", value: 1 }
  });
  assert.deepEqual(play.body.map((instruction) => instruction.id), [
    "bushwhack.units-enter-ready",
    "bushwhack.play-gold-token"
  ]);

  // "Friendly units enter ready this turn": an entry replacement for the
  // controller's units (143.4 / 184.1 / 185.2.d, 369.1/369.3), not a later
  // Ready. The affected units are chosen by characteristics, not targeted
  // (355.10.d), so no TargetSpec is declared.
  assert.equal(enterReady.op, "replacement.enter");
  assert.deepEqual(enterReady.args.duration, { kind: "constant", value: "this-turn" });
  assert.deepEqual(enterReady.args.exhausts, { kind: "constant", value: false });
  assert.deepEqual(enterReady.args.appliesTo, {
    kind: "constant",
    value: { type: "unit", controller: "controller" }
  });
  assert.equal(enterReady.targets, undefined);
  assert.equal(enterReady.picks, undefined);

  // "Play a Gold gear token exhausted": CR 187.5's Gold definition, the
  // 440.2.c / 185.2.a chain-create + play path and the 143.4 / 185.2.d entry
  // stipulation. All three are unmerged (see judgeReason), so the instruction is
  // declared for review and its execution stays a test.todo.
  assert.equal(goldToken.op, "effect.token");
  assert.deepEqual(goldToken.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(goldToken.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(goldToken.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(goldToken.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(goldToken.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(goldToken.linkedTo, undefined);

  // The sentences are independent (no reference between them, 359.3.e.14), so
  // the unmerged entry replacement does not gate the token instruction.
  assert.equal(enterReady.linkedTo, undefined);
});

test.todo(
  "sfd-004-221 Bushwhack: [Hidden]'s expansion must grant the Hide Discretionary Action, the facedown " +
    "zone and the facedown play (811.1.b / 811.1.c / 811.6); the merged cost.hidden declaration has no " +
    "consumer yet — RIFT-84 / RIFT-89."
);

test.todo(
  "sfd-004-221 Bushwhack: 'Friendly units enter ready this turn' is an entry replacement (143.4 / " +
    "184.1 / 185.2.d; 805.6 says it is not 'enter exhausted then become ready'), so it needs a " +
    "temporary replacement.enter registration and the replaced-event object binding — RIFT-9 replacement family."
);

test.todo(
  "sfd-004-221 Bushwhack: playing the Gold gear token needs the CR 187.5 definition (with its own " +
    "printed ability) in the token table, the 440.2.c / 185.2.a chain-create + play handoff, and the " +
    "exhausted entry stipulation of 143.4 / 185.2.d — RIFT-9 / RIFT-62/63 follow-up."
);
