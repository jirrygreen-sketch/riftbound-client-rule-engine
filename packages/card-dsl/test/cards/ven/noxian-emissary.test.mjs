import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ven/noxian-emissary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-f94f709693f78579dcd97c1ebdba7859c74403424ef6cd195238e47541869fbf";
const SOURCE_TEXT =
  "[Empower] :rb_energy_1::rb_rune_order: (:rb_energy_1::rb_rune_order:: Empower me. " +
  "Use only if not Empowered.)\n[Empowered][>][>>][Deathknell][>] Play two 1 :rb_might: " +
  "Recruit unit tokens to your base. (When I die while Empowered, get the effect.)";

const [empower, deathknellEffect] = program.abilities;
const [playRecruits] = deathknellEffect.body;

test("ven-128-166 Noxian Emissary: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test("ven-128-166 Noxian Emissary: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /Empower/);
  assert.match(program.judgeReason, /ObjectSnapshot/);
  assert.match(program.judgeReason, /727\.1\.c\.1/);
  assert.match(program.judgeReason, /RIFT-359/);
});

test("ven-128-166 Noxian Emissary: [Empower] is declared, not re-implemented (contract 3.7)", () => {
  assert.deepEqual(empower, { kind: "keyword", keyword: "empower" });

});

test("ven-128-166 Noxian Emissary: the Empowered Deathknell dependent ability shape", () => {
  assert.equal(deathknellEffect.kind, "triggered");
  // 808.1.d / 429.1.a.1.b: the Deathknell trigger fires on the host being killed
  // and goes on the chain before the zone change.
  assert.equal(deathknellEffect.trigger.at, "object-killed");
  assert.deepEqual(deathknellEffect.trigger.filter, {
    self: true,
    empowered: true,
    cause: "kill",
    destination: "trash"
  });
  assert.equal(deathknellEffect.optional, false);

  assert.equal(playRecruits.id, "noxian-emissary.play-two-recruits");
  assert.equal(playRecruits.op, "effect.token");
  // CR 187.1: Recruit is the 1 Might unit token.
  assert.deepEqual(playRecruits.args.token, { kind: "constant", value: "recruit" });
  assert.deepEqual(playRecruits.args.amount, { kind: "constant", value: 2 });
  // 440.2.c / 185.2.a: a token that is Played is created on the Chain first.
  assert.deepEqual(playRecruits.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playRecruits.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.equal(playRecruits.targets, undefined);
  assert.equal(playRecruits.linkedTo, undefined);
});

test("ven-128-166 golden: 'Play two 1 :rb_might: Recruit unit tokens to your base' runs for real", () => {
  // Execute only the supported token body; the Empowered death gate remains
  // judge-required. The real adapter preserves the primitive's Expr arguments.
  const kernel = world().player("controller").build().clone({ controller: "controller" });
  const outcome = resolveChainBody(deathknellEffect.body, kernel);
  assert.equal(outcome.status, "executed");

  const recruits = kernel.query({ zone: "board", type: "unit" });
  assert.equal(recruits.length, 2);
  for (const recruit of recruits) {
    assert.equal(recruit.name, "Recruit");
    assert.equal(recruit.might, 1);
    assert.deepEqual(recruit.tags, ["Recruit"]);
    assert.equal(recruit.controller, "controller");
    assert.deepEqual(recruit.location, { type: "base", player: "controller" });
    assert.equal(recruit.isToken, true);
    assert.equal(recruit.energy, null);
    assert.equal(recruit.power, null);
  }
  // Both tokens are created on the Chain and then Played (440.2.c / 185.2.a).
  assert.deepEqual(
    outcome.events.map(event => [event.action, event.timingPoint]),
    [
      ["create-token", "chain-item-pending"],
      ["play", "card-played"],
      ["create-token", "chain-item-pending"],
      ["play", "card-played"]
    ]
  );
  assert.deepEqual(kernel.pendingItems, []);
  assert.equal(outcome.linkedValues["noxian-emissary.play-two-recruits.token.amount"], 2);
  assert.equal(outcome.linkedValues["noxian-emissary.play-two-recruits.token.objects"].length, 2);
});

test("ven-128-166 golden: an opponent's base destination negates the token play", () => {
  // Contract 3.6 restricts unit Base destinations to the controller's own Base;
  // the negative case must stay a truthfully reported negation.
  const base = world().player("controller").player("B").build();
  const kernel = base.clone({ controller: "controller" });
  const run = runInstruction(
    token,
    { ...playRecruits.args, location: { kind: "constant", value: { type: "base", player: "B" } } },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.deepEqual(run.events, []);
  assert.equal(run.linked["token.amount"], 0);
  assert.deepEqual(run.linked["token.objects"], []);
  assert.deepEqual(kernel.query({ zone: "board" }), []);
});

test.todo(
  "ven-128-166 Noxian Emissary: expand [Empower] with the printed 1 Energy + 1 Order Power cost " +
    "and enforce use only if not Empowered (827.1.c.1) through the keyword/cost path"
);

test.todo(
  "ven-128-166 Noxian Emissary: evaluate the Empowered dependent Deathknell gate from the host's " +
    "pre-death LKI (727.1.c.1 / 808.1.d.3 / 828.1.b.1), using an Empowered state predicate (RIFT-359)"
);
