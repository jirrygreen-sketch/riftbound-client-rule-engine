import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/jax-unmatched.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import quickDraw from "../../../../engine-core/dist/effects/keywords/Quick-Draw.js";
import deflect from "../../../../engine-core/dist/effects/keywords/Deflect.js";

const CARD_ID = "card.hash-a83dac0c953bf9bfdee67886a82147cb411410a3e9967fae69b37320583c94f9";
const SOURCE_TEXT =
  "[Deflect] (Opponents must pay :rb_rune_rainbow: to choose me with a spell or ability.)\n" +
  "Each Equipment in your hand has [Quick-Draw]. (It gains [Reaction]. When you play it, attach it to a unit you control.)";

const [deflectAbility, grant] = program.abilities;

test("sfd-054-221 Jax, Unmatched: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-054-221 Jax, Unmatched: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /RIFT-91/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-054-221 Jax, Unmatched: [Deflect] keyword plus an Equipment-scoped Quick-Draw grant", () => {
  assert.equal(program.abilities.length, 2);
  // 809.1.b.3: a printed value-less Deflect presumes 1, so no `value` is authored here.
  assert.deepEqual(deflectAbility, { kind: "keyword", keyword: "deflect" });

  assert.equal(grant.kind, "static");
  assert.equal(grant.condition, undefined);
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  assert.equal(grant.effect.keyword, "quick-draw");
  // 150.1/150.5: Equipment is the gear tag; 819 grants Quick-Draw to those gears
  // while they are in your hand (not on the Board).
  assert.deepEqual(grant.effect.filter, {
    zone: "hand",
    type: "gear",
    tags: ["Equipment"],
    controller: "controller"
  });
});

test("sfd-054-221 Jax, Unmatched: the Quick-Draw and Deflect keyword definitions are merged", () => {
  // 契约 3.7 / README 第 5 节：卡只声明关键词，展开归 effects/keywords/<keyword>.ts。
  assert.equal(quickDraw.keyword, "Quick-Draw");
  assert.equal(deflect.keyword, "Deflect");
  assert.equal(deflect.stacking, "sum");
});

test("sfd-054-221 Jax, Unmatched: the granted keyword expands to Reaction timing and a play attach", () => {
  const expansion = quickDraw.expand({ host: { canonicalCardId: CARD_ID } });
  const [timing, attach] = expansion;
  // 819.1.a: Quick-Draw grants [Reaction] while the gear is in hand.
  assert.equal(timing.kind, "static");
  assert.equal(timing.effect.kind, "continuous.timing");
  assert.deepEqual(timing.effect.permissions, ["play", "attach"]);
  // 819.1.b/c: the play trigger attaches the gear to a friendly Unit (435).
  assert.equal(attach.kind, "triggered");
  assert.equal(attach.trigger.at, "card-played");
  assert.equal(attach.body[0].op, "effect.attach");
});

test.todo(
  "sfd-054-221 Jax, Unmatched: 'Each Equipment in your hand has [Quick-Draw]' needs a continuous keyword " +
    "grant whose scope covers the Hand zone, registered from the CardProgram into the layers engine " +
    "(effects/instructions/ has no registered continuous.* opcode and layers/ is not wired to card " +
    "programs) — RIFT-9 / RIFT-91"
);

test.todo(
  "sfd-054-221 Jax, Unmatched: the granted Quick-Draw's continuous.timing permission and its card-played " +
    "attach trigger must reach the chain/target pipeline, and [Deflect]'s target tax must be collected as " +
    "any-domain Power (809.1.c.1) rather than the Energy-shaped tax the chain builds today — " +
    "RIFT-91 / RIFT-90 / RIFT-89"
);
