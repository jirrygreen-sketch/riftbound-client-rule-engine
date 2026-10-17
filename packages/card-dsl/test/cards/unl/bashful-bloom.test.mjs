import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/bashful-bloom.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { buildCostPlan } from "../../../../engine-core/dist/cost/cost-plan.js";
import { payCostPlan } from "../../../../engine-core/dist/cost/payment.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CANONICAL_ID =
  "card.hash-7c38c7fbf3d002c5be05a68b52e8d74195df7d791f974e04b64a12b0a010fb46";
const SOURCE_TEXT =
  ":rb_energy_4:, :rb_exhaust:: Play a ready 3 :rb_might: Sprite unit token with [Temporary]. " +
  "This ability costs :rb_energy_1: less for each friendly unit with [Temporary].";

const [ability] = program.abilities;
const [playSprite] = ability.body;

test("unl-189-219 Bashful Bloom: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-189-219 Bashful Bloom: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /sprite/);
  assert.match(program.judgeReason, /187\.2/);
  assert.match(program.judgeReason, /184\.1/);
  assert.match(program.judgeReason, /cost\.modify/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-265/);
});

test("unl-189-219 Bashful Bloom: 4 Energy + Exhaust, action speed, no cost modifier merged into the plan", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "activated");
  // 404.1.a / 415.5: printed ":rb_energy_4:, :rb_exhaust:"; no [Reaction], so
  // the default Action timing applies.
  assert.equal(ability.timing, "action");
  assert.deepEqual(ability.cost, {
    kind: "activated",
    energy: { kind: "constant", value: 4 },
    payments: [{ kind: "exhaust", object: "self" }]
  });
});

test("unl-189-219 Bashful Bloom: one Sprite token play with the ready and Temporary stipulations", () => {
  assert.equal(playSprite.id, "bashful-bloom.play-sprite");
  assert.equal(playSprite.op, "effect.token");
  // 187.2: 3 [M] Sprite token = domainless unit token, 3 Might, Fae tag, and
  // the Temporary keyword; the frozen definition table has no sprite entry and
  // 440.2.c / 185.2.a need chain creation for "Play ... token".
  assert.deepEqual(playSprite.args.token, { kind: "constant", value: "sprite" });
  assert.deepEqual(playSprite.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(playSprite.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(playSprite.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  // 184.1: "ready" is an entry-state override; create-token has no such
  // argument and creating then readying would fire a spurious "becomes ready"
  // event, so no entry-state argument is invented here (see judgeReason).
  assert.deepEqual(Object.keys(playSprite.args).sort(), ["amount", "linkKey", "location", "mode", "token"]);
  assert.equal(playSprite.linkedTo, undefined);
  assert.equal(playSprite.targets, undefined);
  assert.equal(playSprite.picks, undefined);
});

test("unl-189-219 Bashful Bloom: the printed 4-Energy cost is payable through the merged cost pipeline", () => {
  const kernel = world()
    .player("A", { energy: 5 })
    .unit("bloom", { zone: "board", types: ["legend"], controller: "A", exhausted: false })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("bloom")) });
  const plan = buildCostPlan(ctx, { id: "bashful-bloom", cost: ability.cost });
  const receipt = payCostPlan(ctx, plan);
  assert.equal(receipt.paid, true);
  assert.equal(receipt.total.energy, 4);
  assert.deepEqual(receipt.actions.map(action => action.action.type), ["pay", "exhaust"]);
  assert.equal(ctx.player("A").energy, 1);
  assert.equal(ctx.object(ctx.ref("bloom")).exhausted, true);
});

test("unl-189-219 Bashful Bloom: the sprite play is blocked by the frozen token table, not approximated", () => {
  const kernel = world().build();
  const run = runInstruction(
    token,
    {
      token: playSprite.args.token,
      mode: playSprite.args.mode,
      amount: playSprite.args.amount,
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "impossible");
  assert.equal(run.linked.token.amount, 0);
  assert.equal(run.linked.token.blockedReason, "token-definition-or-abilities-judge-required");
  assert.deepEqual(kernel.query({ zone: "board", type: "unit" }), []);
  assert.deepEqual(kernel.events, []);
});

test.todo(
  "unl-189-219 Bashful Bloom: add the 3 Might Sprite token (CR 187.2: domainless, Fae tag, Temporary keyword) to the token definitions"
);
test("unl-189-219 Bashful Bloom: the Temporary KeywordDef the Sprite token needs is merged", () => {
  // CR 187.2 gives the Sprite token [Temporary]; RIFT-265 merged the KeywordDef,
  // so the token's ability half is available even though the token definition
  // itself (and the ready entry override) is still missing.
  const temporary = keywordDefinitionsById.get("Temporary");
  assert.ok(temporary, "effects/keywords/Temporary.ts must be registered");
  const [expanded] = temporary.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expanded.trigger.at, "beginning-start");
  assert.deepEqual(expanded.body.map(step => [step.op, step.args.self]), [
    ["effect.kill", { kind: "constant", value: true }]
  ]);
});

test("unl-189-219 Bashful Bloom: mode \"play\" really creates on the Chain and hands the token to play", () => {
  // 440.2.c / 185.2.a / 350.2 / 354: the merged effect.token creates on the
  // Chain and then performs the play for that ref. The Sprite definition itself
  // is still missing (CR 187.2), so the handoff is exercised with a token the
  // frozen table does define — never substituted into the card.
  const kernel = world().player("A", { energy: 0 }).build();
  const run = runInstruction(
    token,
    {
      token: { kind: "constant", value: "mech" },
      mode: { kind: "constant", value: "play" },
      location: { kind: "constant", value: { type: "base", player: "A" } }
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  assert.equal(run.linked.token.createdAmount, 1);
  assert.equal(run.linked.token.amount, 1);
  assert.deepEqual(run.events.map(event => [event.action, event.timingPoint]), [
    ["create-token", "chain-item-pending"],
    ["play", "card-played"]
  ]);
  assert.equal(kernel.objects.find(object => object.isToken).zone, "board");
});

test.todo(
  "unl-189-219 Bashful Bloom: add the 3 Might Sprite token to the frozen effect.token definitions (CR 187.2: " +
    "domainless, Fae tag, Temporary keyword)"
);

test.todo(
  "unl-189-219 Bashful Bloom: cost.modify reduction of 1 Energy per friendly unit with [Temporary] in the cost " +
    "plan's discount stage (RIFT-261); count/ObjectFilter also have no keyword-characteristic dimension"
);
test.todo(
  "unl-189-219 Bashful Bloom: ready entry override for the created token (CR 143.4 / 184.1) — not create-then-ready"
);
test.todo(
  "unl-189-219 Bashful Bloom: cost.modify reduction of 1 Energy per friendly unit with [Temporary] in the cost plan's discount stage (RIFT-89)"
);
