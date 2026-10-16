import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/production-surge.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";

const staticAbility = program.abilities[0];
const play = program.abilities[1];
const tokenInstruction = play.body[0];
const drawInstruction = play.body[1];

test("Production Surge program is valid EffectIR v2 data", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("Production Surge identity and status match the printing", () => {
  assert.equal(
    program.canonicalCardId,
    "card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b"
  );
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "executable");
  assert.equal(program.judgeReason, undefined);
  assert.match(program.sourceText, /This costs :rb_energy_2: less if you control a Mech./);
  assert.match(program.sourceText, /Play a 3 :rb_might: Mech unit token to your base./);
  assert.match(program.sourceText, /Draw 1./);
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("Production Surge structure: conditional cost reduction static ability", () => {
  assert.equal(staticAbility.kind, "static");
  assert.equal(staticAbility.effect.kind, "continuous.cost-modification");
  assert.equal(staticAbility.effect.amount, -2);
  assert.equal(staticAbility.effect.resource, "energy");
  assert.equal(staticAbility.effect.appliesTo, "self");

  // "if you control a Mech": count controlled Mech-tagged units, require >= 1.
  const condition = staticAbility.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.equal(condition.left.kind, "count");
  assert.deepEqual(condition.left.filter, { tags: "Mech", controller: "you" });
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
});

test("Production Surge structure: token play then an independent draw", () => {
  assert.equal(play.kind, "play");
  assert.equal(play.body.length, 2);

  // "Play a 3 [M] Mech unit token to your base": the merged effect.token op
  // with the Mech definition (CR 187.4) in play mode (440.2.c / 185.2.a).
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "you" }
  });

  // "Draw 1." is a separate instruction with no link to the token half
  // (359.3.e.11: resolve as much as possible).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
});

test("Production Surge golden execution: the Mech token play is blocked, not approximated", () => {
  // The merged kernel create-token action only creates directly on the Board,
  // so mode "play" is explicitly negated by effect.token (contract changelog
  // RIFT-62). Asserting the block guards against a silent approximation.
  const kernel = world().build();
  const run = runInstruction(token, tokenInstruction.args, { world: kernel });

  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.events.length, 0);
  assert.equal(run.linked["token.amount"], 0);
  assert.deepEqual(run.linked["token.objects"], []);
  assert.equal(kernel.query({}).length, 0);
});

test("Production Surge golden execution: Draw 1 takes the top card", () => {
  const kernel = world().deck("deeper-card").deck("top-card").build();
  const run = runInstruction(draw, drawInstruction.args, { world: kernel });

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.player("A").handSize, 1);
  assert.equal(kernel.player("A").deckSize, 1);
  assert.deepEqual(
    kernel.zone("A", "hand").map(ref => ref.id),
    ["top-card"]
  );
  assert.equal(run.linked.drawn, 1);
});

test.todo(
  "Production Surge: applying the conditional -2 energy reduction at Finalize needs the " +
    "cost modification consumer in the cost plan (RIFT-89) and the layers condition " +
    "evaluation of 'you control a Mech' (RIFT-91)."
);

test.todo(
  "Production Surge: actually playing the Mech token needs create-token's chain " +
    "destination plus the effect.play handoff (440.2.c / 185.2.a / 350.2 / 354, contract " +
    "changelog RIFT-62; effect.token RIFT-63 follow-up)."
);
