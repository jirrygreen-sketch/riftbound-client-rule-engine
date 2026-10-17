import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/chem-baroness.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { buildCostPlan, payCostPlan } from "../../../../engine-core/dist/cost/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-db953801bed05d82fb44e885fa9fb48eee8dd92368d3933f1b858ca4c05c67e5";
const SOURCE_TEXT =
  "When you or an ally hold, you may exhaust me to play a Gold gear token exhausted.\n" +
  "While your score is within 3 points of the Victory Score, your Gold [Add] an additional :rb_energy_1:.";

const [holdTrigger, goldBonus] = program.abilities;
const optionalAbility = holdTrigger.body[0];
const optionalBody = optionalAbility.args.body.value;
const [payExhaust, playGold] = optionalBody;

const legendWorld = ({ exhausted = false } = {}) => {
  const base = world()
    .unit("chem-baroness", { types: ["legend"], exhausted, location: { type: "base", player: "A" } })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("chem-baroness") });
};

test("sfd-201-221 Chem-Baroness: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-201-221 Chem-Baroness: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /143\.4/);
  assert.match(program.judgeReason, /Victory Score/);
  assert.match(program.judgeReason, /ally/);
});

test("sfd-201-221 Chem-Baroness: 'when you or an ally hold' is a Hold Effect for the controller", () => {
  assert.equal(program.abilities.length, 2);
  assert.equal(holdTrigger.kind, "triggered");
  // 383.4.d / 383.4.d.1: the conditional clause is the Hold; the closed timing
  // point is `hold` (CR 315.2.b.2 / 471.2 / 473.2.b).
  assert.equal(holdTrigger.trigger.at, "hold");
  assert.deepEqual(holdTrigger.trigger.filter, { event: "hold", player: "self" });
  assert.equal(holdTrigger.trigger.once, undefined);
  assert.equal(holdTrigger.trigger.condition, undefined);
  // 403.1 / 383.3.a: the leading "you may" is the triggered ability's own
  // optionality; 3.9 wraps the chosen instructions in choice.optional.
  assert.equal(holdTrigger.optional, true);
  assert.equal(holdTrigger.body.length, 1);
});

test("sfd-201-221 Chem-Baroness: the may-body pays the exhaust cost then plays a Gold token", () => {
  assert.equal(optionalAbility.id, "chem-baroness.may-play-gold");
  assert.equal(optionalAbility.op, "choice.optional");
  assert.equal(optionalAbility.linkedTo, undefined);
  assert.deepEqual(optionalAbility.args.prompt, {
    kind: "constant",
    value: "Exhaust Chem-Baroness to play a Gold gear token exhausted?"
  });
  assert.deepEqual(optionalBody.map(instruction => [instruction.id, instruction.op]), [
    ["chem-baroness.pay-exhaust", "cost.pay"],
    ["chem-baroness.play-gold", "effect.token"]
  ]);

  // "exhaust me": 415.4/415.5 — the exhaust is a cost, not effect.exhaust's
  // state change.
  assert.deepEqual(payExhaust.args, {
    payments: { kind: "constant", value: [{ kind: "exhaust", object: "self" }] }
  });

  // "play a Gold gear token exhausted": 187.5's Gold definition, the 440.2.c /
  // 185.2.a chain-create handoff, and the 185.2.d / 143.4 entry state.
  assert.deepEqual(playGold.args, {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    linkKey: { kind: "constant", value: "goldToken" }
  });
  assert.equal(playGold.linkedTo, "chem-baroness.pay-exhaust");
});

test("sfd-201-221 Chem-Baroness: declining the hold trigger pays nothing and creates nothing", () => {
  const kernel = legendWorld();
  kernel.setAnswers({ "chem-baroness.may-play-gold/optional": false });

  const outcome = resolveChainBody(holdTrigger.body, kernel);

  assert.equal(outcome.status, "partial");
  assert.deepEqual(outcome.results.map(result => [result.id, result.result.status, result.result.reason]), [
    ["chem-baroness.may-play-gold", "negated", "skipped"]
  ]);
  assert.equal(kernel.getObject("chem-baroness").exhausted, false);
  assert.deepEqual(kernel.events, []);
  // No Gold gear token was created anywhere (only the legend host exists).
  assert.equal(kernel.query({ zone: "board", type: "gear" }).length, 0);
});

test("sfd-201-221 Chem-Baroness: the printed exhaust cost is charged as a real exhaust payment", () => {
  const kernel = legendWorld();
  const plan = buildCostPlan(kernel, {
    id: "cost:chem-baroness",
    cost: { kind: "activated", payments: payExhaust.args.payments.value }
  });

  assert.deepEqual(plan.total.actions.map(entry => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("chem-baroness").exhausted, true);
});

test("sfd-201-221 Chem-Baroness: 'your Gold [Add] an additional :rb_energy_1:' is a conditional static effect", () => {
  assert.equal(goldBonus.kind, "static");
  // "While your score is within 3 points of the Victory Score": a named
  // condition with no merged provider (see judgeReason) — never a hard-coded 8.
  assert.deepEqual(goldBonus.condition, {
    kind: "expression",
    value: { kind: "constant", value: "your-score-within-3-of-victory-score" }
  });
  assert.equal(goldBonus.effect.kind, "modify-resource-ability");
  assert.equal(goldBonus.effect.resource, "energy");
  assert.deepEqual(goldBonus.effect.amount, { kind: "constant", value: 1 });
  // "your Gold": 740.1.a controller scope plus 187.5's printed token name.
  assert.deepEqual(goldBonus.effect.filter, {
    type: "gear",
    controller: "controller",
    zone: "board",
    characteristics: { name: "Gold" }
  });
});

test("sfd-201-221 Chem-Baroness: the Gold scope matches the named token only", () => {
  // Bind the controller placeholder as the pipeline does; then only a gear
  // named Gold that this player controls is in scope. An Equipment gear or an
  // opponent's Gold is not "your Gold".
  const controller = "A";
  const filter = Object.fromEntries(
    Object.entries(goldBonus.effect.filter).map(([key, value]) => [
      key,
      value === "controller" ? controller : value
    ])
  );
  const gear = overrides => ({
    ref: { id: "x", zoneEntryId: 1 },
    cardId: null,
    name: "Gold",
    types: ["gear"],
    tags: ["Token"],
    keywords: [],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: null,
    energy: null,
    power: null,
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: true,
    printed: null,
    actionTimings: [],
    availableTimings: [],
    movement: { allowed: true, canMove: true, canGank: false, restrictions: [] },
    text: null,
    effectText: null,
    ...overrides
  });

  assert.equal(matchesObjectFilter(filter, gear({})), true);
  assert.equal(matchesObjectFilter(filter, gear({ name: "Long Sword", tags: ["Equipment"] })), false);
  assert.equal(matchesObjectFilter(filter, gear({ controller: "B" })), false);
  assert.equal(matchesObjectFilter(filter, gear({ types: ["unit"], might: 2 })), false);
});

test.todo(
  "sfd-201-221 Chem-Baroness: the Gold gear token (187.5, with its own 'Kill this, [E]: [Add] [A]' ability) " +
    "cannot be created by the merged effect.token primitive; it reports " +
    "blockedReason 'token-definition-or-abilities-judge-required' for definitions with their own abilities"
);
test.todo(
  "sfd-201-221 Chem-Baroness: 'exhausted' is an entry state (143.4/185.2.d) that effect.token does not " +
    "support; adding effect.exhaust afterwards would emit a second 'becomes exhausted' event and is not equivalent"
);
test.todo(
  "sfd-201-221 Chem-Baroness: 'within 3 points of the Victory Score' needs the current Victory Score " +
    "(194.3/194.3.a), which PlayerSnapshot/ResolveContext do not expose; hard-coding the default 8 would invent semantics"
);
test.todo(
  "sfd-201-221 Chem-Baroness: 'or an ally' is the Teammate relation (491.8.e); ResolveContext has no ally/team " +
    "concept, so a teammate's Hold cannot be combined with the controller's"
);
test.todo(
  "sfd-201-221 Chem-Baroness: 'your Gold [Add] an additional :rb_energy_1:' needs a conditional continuous " +
    "effect over resource abilities plus a CardProgram -> LayerEngine registration path (RIFT-257)"
);

test("sfd-201-221 Chem-Baroness: the exhaust cost is charged as a real payment through the merged cost plan", () => {
  // 415.4/415.5: "exhaust me" is a cost, so it is charged by the cost plan and
  // not by effect.exhaust. The declared payment really exhausts the legend.
  const kernel = legendWorld();
  const plan = buildCostPlan(kernel, {
    id: "cost:chem-baroness:exhaust",
    cost: { kind: "activated", payments: [{ kind: "exhaust", object: "self" }] }
  });
  assert.deepEqual(plan.total.actions.map((entry) => entry.action.type), ["exhaust"]);
  const receipt = payCostPlan(kernel, plan);
  assert.equal(receipt.paid, true);
  assert.equal(kernel.getObject("chem-baroness").exhausted, true);
});

test("sfd-201-221 Chem-Baroness: the merged effect.token primitive refuses the Gold definition", () => {
  // The optional body names the printed "gold" definition; the merged primitive
  // refuses definitions with their own abilities (CR 187.5). The refusal is the
  // actual evidence for the judge-required Gold half, and nothing is created
  // in its place.
  const kernel = legendWorld();
  const run = runInstruction(token, {
    token: { kind: "constant", value: "gold" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "play" },
    location: { kind: "constant", value: { type: "base", player: "A" } },
    linkKey: { kind: "constant", value: "goldToken" }
  }, { world: kernel });

  assert.deepEqual(run.result, { status: "negated", reason: "impossible", events: [] });
  assert.equal(run.linked.goldToken.blockedReason, "token-definition-or-abilities-judge-required");
  assert.deepEqual(kernel.objects.filter((object) => object.isToken).map((object) => object.ref.id), []);
});
