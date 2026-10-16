import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/deserts-call.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL = "card.hash-13dac6e5e0aae54e0dba3935b0e7416d5e1cfe13a2c7817a155c406b27f0e5bf";
const SOURCE_TEXT =
  "[Repeat] :rb_energy_2: (You may pay the additional cost to repeat this spell's effect.)\n" +
  "Play a 2 :rb_might: Sand Soldier unit token.";

const [play] = program.abilities;
const [playToken] = play.body;

test("sfd-031-221 Desert's Call: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-031-221 Desert's Call: judge-required for the open destination and the Repeat wiring", () => {
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /355\.2/);
  assert.match(program.judgeReason, /target\.location/);
  assert.match(program.judgeReason, /820\.1\.c\.1/);
  assert.match(program.judgeReason, /RIFT-89/);
});

test("sfd-031-221 Desert's Call structure: no speed keyword, the Repeat payment and the Sand Soldier play", () => {
  // The printed ability line has no [Action]/[Reaction]/[Hidden] keyword, so no
  // speed keyword is declared; the spell keeps its default timing (159.2).
  assert.equal(program.abilities.length, 1);
  assert.equal(play.kind, "play");

  // [Repeat] :rb_energy_2: (820.1.c): the printed additional cost with the
  // explicit pay/decline decision 820.1.b requires.
  assert.equal(play.cost.kind, "additional");
  assert.equal(play.cost.payments.length, 1);
  const [payment] = play.cost.payments;
  assert.equal(payment.kind, "energy");
  assert.deepEqual(payment.amount, { kind: "constant", value: 2 });
  assert.equal(payment.choice.id, "deserts-call.repeat-payment");
  assert.deepEqual(payment.choice.options, ["pay", "decline"]);
  assert.equal(payment.choice.selection, "one");

  // "Play a 2 :rb_might: Sand Soldier unit token": the merged CR 187.3 frozen
  // definition and the 440.2.c / 185.2.a chain-create + play path.
  assert.equal(play.body.length, 1);
  assert.equal(playToken.id, "deserts-call.play-sand-soldier-token");
  assert.equal(playToken.op, "effect.token");
  assert.deepEqual(playToken.args.token, { kind: "constant", value: "sand-soldier" });
  assert.deepEqual(playToken.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playToken.args.mode, { kind: "constant", value: "play" });
  assert.equal(playToken.linkedTo, undefined);
  assert.equal(playToken.targets, undefined);

  // The printed text names no destination, so the 355.2 / 355.2.a legal-location
  // choice is left open rather than pinned to a Base (which would delete the
  // printed Battlefield options); the missing destination expression is recorded
  // in judgeReason.
  assert.equal(playToken.args.location, undefined);
  assert.equal(playToken.args.target, undefined);
  assert.equal(playToken.args.pick, undefined);
  assert.equal(playToken.args.locations, undefined);
});

test("sfd-031-221 Desert's Call golden: the Sand Soldier token lands as a 2 Might Shurima unit", () => {
  // The golden run supplies the concrete Base the missing Finalize-time
  // legal-location choice would pick; the token definition itself (187.3) is the
  // merged frozen one, so this executes the real create + play path.
  const kernel = world().player("A").build();
  const base = { type: "base", player: "A" };
  const run = runInstruction(
    token,
    {
      token: playToken.args.token,
      amount: playToken.args.amount,
      mode: playToken.args.mode,
      location: { kind: "constant", value: base },
      linkKey: playToken.args.linkKey
    },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.deepEqual(run.events.map((event) => event.timingPoint), ["chain-item-pending", "card-played"]);
  const soldiers = kernel.query({ zone: "board", type: "unit" }).filter((object) => object.isToken);
  assert.equal(soldiers.length, 1);
  const [soldier] = soldiers;
  assert.equal(soldier.name, "Sand Soldier");
  // 185.2.b / 187.3: the token unit has 2 Might; 185.3.a keeps its printed
  // Energy and Power null (never rewritten as 0).
  assert.equal(soldier.might, 2);
  assert.deepEqual(soldier.tags, ["Shurima"]);
  assert.equal(soldier.energy, null);
  assert.equal(soldier.power, null);
  assert.deepEqual(soldier.location, base);
  assert.equal(soldier.controller, "A");
  assert.equal(run.linked["sandSoldierToken.amount"], 1);
});

test.todo(
  "sfd-031-221 Desert's Call: at Finalize the player chooses the token's valid Location (355.2 / " +
    "355.2.a, 440.2.b.1, 420.3.b.2: the controller's Base or a Battlefield they control); the " +
    "legal-location set has no Expr form — RIFT-9 target.location."
);

test.todo(
  "sfd-031-221 Desert's Call: collecting the optional 2-energy Repeat cost at Finalize, exposing the " +
    "paid count to the effect execution, and re-making choices for the additional execution " +
    "(820.1.c.1 / 820.1.d.1 / 820.2) need the Repeat cost wiring and the cost plan — RIFT-86 / RIFT-89."
);
