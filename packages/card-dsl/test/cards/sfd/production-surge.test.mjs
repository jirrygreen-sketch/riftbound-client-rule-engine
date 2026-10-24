import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/production-surge.js";
import draw from "../../../../engine-core/dist/effects/instructions/effect.draw.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { cardProgramsById, cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { productionPlay } from "../../fixtures/production-play.mjs";

// Official interaction evidence:
// - Core Rules v1.5 (last updated 2026-10-09, effective 2026-10-16):
//   https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/5c7946f7c3b8c6e0faff85ab6dadc6d2e721ea94.pdf
// - Radiance patch notes, effective 2026-10-16:
//   https://playriftbound.com/en-us/news/announcements/core-rules-radiance-patch-notes-effective-october-16-2026/
// canonicalCardId: card.hash-1504d8f14af5ce1b9f7a3663c23e6ef7cb57d59a6274dc921cd9296ee8e2494b.
// "This costs less" is a self cost modification frozen during 356.4.g; 357
// pays the reduced total. The spell is Pending, Finalizes with no target,
// receives both Priority passes under 337.1.a/338/339.1, then 359.3.d executes
// its instructions top-to-bottom. The token Play uses 440.2.c/185.2.a and the
// 187.4 Mech enters exhausted (143.4); the independent Draw 1 follows under
// 359.3.e.11.
// The neutral Main-phase spell creates no Focus, and its response window is the
// ordinary Chain window. Neither instruction depends on departed-object LKI.

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
  // "your base" is the controller-relative Base selector the token primitive
  // resolves; a literal "you" is not a player id and played nothing.
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "mech" });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });

  // "Draw 1." is a separate instruction with no link to the token half
  // (359.3.e.11: resolve as much as possible).
  assert.equal(drawInstruction.op, "effect.draw");
  assert.deepEqual(drawInstruction.args, { amount: { kind: "constant", value: 1 } });
  assert.equal(drawInstruction.linkedTo, undefined);
  assert.equal(drawInstruction.targets, undefined);
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

// Production path: registry program, ProgramBinding.describePlay, ChainEngine
// Finalize (cost collection + payment) and Resolve.
const CANONICAL_ID = program.canonicalCardId;

function surge({ energy, friendlyMech = false, enemyMech = false }) {
  return productionPlay({
    programs: cardProgramsById,
    build: (w) => {
      let built = w.player("A", { energy, power: [] }).player("B", { energy: 2 })
        .object("surge", { owner: "A", controller: "A", cardId: CANONICAL_ID, types: ["spell"], zone: "hand", energy: 4, power: [] })
        .object("next-card", { owner: "A", controller: "A", types: ["unit"], zone: "deck", might: 1 });
      if (friendlyMech) built = built.unit("my-mech", { owner: "A", controller: "A", might: 2, tags: ["Mech"], location: { type: "base", player: "A" } });
      if (enemyMech) built = built.unit("their-mech", { owner: "B", controller: "B", might: 2, tags: ["Mech"], location: { type: "base", player: "B" } });
      return built;
    }
  });
}

const playedMechTokens = (kernel) => kernel.objects.filter((object) => object.isToken && object.zone === "board");

function assertResolved(f) {
  // CR 187.4: the Mech token is a 3 Might Mech unit token, played to the
  // controller's Base (440.2.c) and entering exhausted (143.4).
  const tokens = playedMechTokens(f.kernel);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].name, "Mech");
  assert.equal(tokens[0].might, 3);
  assert.deepEqual(tokens[0].tags, ["Mech"]);
  assert.equal(tokens[0].controller, "A");
  assert.deepEqual(tokens[0].location, { type: "base", player: "A" });
  assert.equal(tokens[0].exhausted, true);
  // Draw 1 (414.3).
  assert.deepEqual(f.kernel.zone("A", "hand").map((ref) => ref.id), ["next-card"]);
  assert.equal(f.engine.items.length, 0);
}

test("Production Surge production golden: without a Mech it costs the printed 4 Energy", () => {
  const f = surge({ energy: 4 });
  f.play("surge");
  assert.equal(f.kernel.player("A").energy, 0);
  assertResolved(f);
});

test("Production Surge production golden: controlling a Mech makes it cost 2 less at Finalize", () => {
  const f = surge({ energy: 4, friendlyMech: true });
  f.play("surge");
  assert.equal(f.kernel.player("A").energy, 2);
  assertResolved(f);
});

test("Production Surge production golden: with a Mech it is playable from exactly 2 Energy", () => {
  const f = surge({ energy: 2, friendlyMech: true });
  f.play("surge");
  assert.equal(f.kernel.player("A").energy, 0);
  assertResolved(f);
});

test("Production Surge production golden: an opponent's Mech does not reduce the cost", () => {
  const f = surge({ energy: 2, enemyMech: true });
  assert.throws(() => f.play("surge"), /insufficient Energy/);
  assert.equal(f.kernel.player("A").energy, 2);
  assert.deepEqual(f.kernel.zone("A", "hand").map((ref) => ref.id), ["surge"]);
  assert.equal(playedMechTokens(f.kernel).length, 0);
});
