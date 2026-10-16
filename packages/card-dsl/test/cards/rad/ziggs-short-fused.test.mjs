// Golden test for Ziggs, Short-Fused (rad-023-167).
//
// judge-required (see the program's judgeReason): the Bomb gear token and its
// Deploy/Deathknell abilities are absent from the frozen effect.token table, a
// printed "to a battlefield" destination cannot be enumerated by static IR, and
// the friendly-gear Bonus Damage grant has no layer consumer. The runnable
// evidence is (a) the play effect's real structure, (b) the reference kernel
// rejecting the Bomb definition instead of inventing one, and (c) the merged
// chain-create + play handoff for a token the frozen table does define.
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/rad/ziggs-short-fused.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import damage from "../../../../engine-core/dist/effects/instructions/effect.damage.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL =
  "card.hash-143c51170da933db17fe250dec223607e32fd758ab3825c4f009ce0d78c4d1b5";
const SOURCE_TEXT =
  "When you play me, play a Bomb gear token to a battlefield. " +
  "(It has [Deploy]. When it dies, deal 2 to an enemy there and kill your other Bombs there.)\n" +
  "Abilities of friendly gear deal 1 Bonus Damage.";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [playEffect, bonusDamage] = program.abilities;
const [tokenInstruction] = playEffect.body;

test("rad-023-167 Ziggs, Short-Fused: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("rad-023-167 Ziggs, Short-Fused: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  // README §2: name the missing token definition, destination form and consumer.
  assert.match(program.judgeReason, /Bomb/);
  assert.match(program.judgeReason, /187\.12/);
  assert.match(program.judgeReason, /355\.2\.a/);
  assert.match(program.judgeReason, /Bonus Damage/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("rad-023-167 Ziggs, Short-Fused: 'When you play me' play effect creating a Bomb token", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(playEffect.kind, "triggered");
  assert.equal(playEffect.trigger.at, "card-played");
  assert.deepEqual(playEffect.trigger.filter, {
    event: "card-played",
    filter: { source: "self", player: "self" }
  });
  assert.equal(playEffect.optional, false);

  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "bomb" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  // 185.2.a / 440.2.c: a token that is "played" is created on the Chain first.
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  // 355.10.b: the battlefield is a play destination, not a target.
  assert.equal(tokenInstruction.targets, undefined);
  assert.equal(tokenInstruction.picks, undefined);
  assert.deepEqual(tokenInstruction.args.linkKey, {
    kind: "constant",
    value: "bombToken"
  });
});

test("rad-023-167 Ziggs, Short-Fused: the Bonus Damage grant declares friendly gear abilities", () => {
  // CR 418.4/418.5/713: Bonus Damage is granted to the Deal action; 714 sums
  // instances, 715.2 applies it per target, 715.4 skips zero-damage deals.
  assert.equal(bonusDamage.kind, "static");
  assert.equal(bonusDamage.effect.kind, "continuous.bonus-damage");
  assert.equal(bonusDamage.effect.layer, "ability");
  assert.deepEqual(bonusDamage.effect.amount, { kind: "constant", value: 1 });
  assert.equal(bonusDamage.effect.appliesTo, "deal-actions");
  assert.deepEqual(bonusDamage.effect.filter, {
    type: "gear",
    controller: "controller",
    zone: "board"
  });
});

test("rad-023-167 Ziggs, Short-Fused: the frozen token table refuses to invent the Bomb definition", () => {
  const kernel = world().unit("ziggs", { might: 5, location: BATTLEFIELD }).build();
  const run = runInstruction(token, tokenInstruction.args, { world: kernel });
  // The primitive fails closed and names the reason instead of creating a token
  // with guessed abilities: CR 187.12 defines Bomb with [Deploy] and [Deathknell].
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.bombToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(run.linked.bombToken.amount, 0);
  assert.deepEqual(run.linked.bombToken.objects, []);
  assert.equal(kernel.objects.filter((object) => object.isToken).length, 0);
});

test("rad-023-167 Ziggs, Short-Fused: the merged chain-create + play handoff works for a defined token", () => {
  // The Bomb definition is the judged part. To show the instruction really is a
  // create-on-chain + play flow, the same args are run with the frozen Mech
  // definition (187.4), whose abilities are fully known to the merged table.
  const kernel = world().unit("ziggs", { might: 5, location: BATTLEFIELD }).build();
  const substitutes = {
    ...tokenInstruction.args,
    token: { kind: "constant", value: "mech" },
    location: { kind: "constant", value: BATTLEFIELD }
  };
  const run = runInstruction(token, substitutes, { world: kernel });
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.bombToken.amount, 1);
  assert.equal(run.linked.bombToken.objectsComplete, true);
  assert.equal(run.linked.bombToken.createdAmount, 1);
  const [created] = kernel.objects.filter((object) => object.isToken);
  assert.equal(created.name, "Mech");
  assert.deepEqual(created.location, BATTLEFIELD);
  // The declaration itself still names Bomb and mode "play".
  assert.equal(tokenInstruction.args.token.value, "bomb");
  assert.equal(tokenInstruction.args.mode.value, "play");
});

test("rad-023-167 Ziggs, Short-Fused: effect.damage applies a passed-in Bonus Damage (712-715)", () => {
  // The grant is judged; the arithmetic the grant feeds into is merged, so the
  // golden proves 714/715.2 with the printed +1 for a gear-source deal action.
  const kernel = world()
    .unit("gear-bearer", { might: 3 })
    .unit("enemy", { owner: "B",might: 3 })
    .build();
  const enemyRef = kernel.ref("enemy");
  const sourceRef = kernel.ref("gear-bearer");
  const scoped = kernel.clone({ sourceSnapshot: kernel.getObject("gear-bearer") });
  const run = runInstruction(
    damage,
    {
      amount: { kind: "constant", value: 1 },
      bonus: { kind: "constant", value: 1 },
      target: "enemy",
      source: { kind: "constant", value: sourceRef }
    },
    { world: scoped, targets: { enemy: [enemyRef] } }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(scoped.getObject("enemy").damage, 2);
});

test.todo(
  "Ziggs, Short-Fused: the CR 187.12 Bomb gear token definition (domainless gear, [Deploy] + [Deathknell] " +
    "'Deal 2 to an enemy unit here and kill all other Bombs you control here.') — blocked because effect.token's frozen " +
    "table omits definitions with abilities and the Deploy (830) / Deathknell (808) expansions plus their chain wiring are unmerged"
);

test.todo(
  "Ziggs, Short-Fused: playing the Bomb 'to a battlefield' (355.2.a legal locations) — blocked because IR has no expression " +
    "for the set of current battlefields and effect.token requires a literal LocationRef or an author-supplied option list"
);

test.todo(
  "Ziggs, Short-Fused: 'Abilities of friendly gear deal 1 Bonus Damage' — blocked because no merged consumer registers the " +
    "continuous.bonus-damage grant as a LayerEngine effect and feeds it into Deal actions (RIFT-91)"
);
