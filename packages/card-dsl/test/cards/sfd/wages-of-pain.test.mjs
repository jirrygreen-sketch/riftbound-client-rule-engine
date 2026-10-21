import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/sfd/wages-of-pain.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { instructionDefinitionsById } from "../../../../engine-core/dist/effects/instructions/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import token from "../../../../engine-core/dist/effects/instructions/effect.token.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createEngineStaticBinder } from "../../../../engine-core/dist/programs/index.js";
import { TOKEN_DEFINITIONS } from "../../../../engine-core/dist/effects/tokens/definitions.js";
import { productionPlay } from "../../fixtures/production-play.mjs";
import { AwaitChoice } from "../../../../engine-core/dist/effects/contract.js";

const CARD_ID = "card.hash-431738fdce44471075e7d0f77a009dde71d56c7be7e2c9ef022d6b124a857a3c";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "[Action] (Play on your turn or in showdowns.)\n" +
  "Deal 3 to a unit at a battlefield. Play a Gold gear token exhausted.";

const play = program.abilities.find((ability) => ability.kind === "play");
const dealInstruction = play.body[0];
const tokenInstruction = play.body[1];

// The ProgramRegistry intentionally rejects judge-required programs. The probe
// changes only the status gate to exercise the already-authored body through
// the same default binder and ChainEngine; the published program stays blocked.
const admittedProbeProgram = { ...program, status: "executable", judgeReason: undefined };

function wagesScene({ answers = { "target:damaged-unit": ["victim"] }, energy = 3 } = {}) {
  return productionPlay({
    programs: [admittedProbeProgram],
    answers,
    build: (builder) => builder
      .player("A", { energy, power: [] })
      .player("B", { energy: 0, power: [] })
      .object("wages", {
        owner: "A",
        controller: "A",
        cardId: CARD_ID,
        name: "Wages of Pain",
        types: ["spell"],
        zone: "hand",
        energy: 3,
        power: null,
        might: null,
        location: null
      })
      .unit("victim", {
        owner: "B",
        controller: "B",
        name: "Battlefield victim",
        might: 5,
        location: { type: "battlefield", id: "bf1" }
      })
      .unit("base-only", {
        owner: "B",
        controller: "B",
        name: "Base-only unit",
        might: 5,
        location: { type: "base", player: "B" }
      })
  });
}

test("sfd-070-221 Wages of Pain: program validates and is registered", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-070-221 Wages of Pain: stays judge-required only for the current Gold and Hidden gaps", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /187\.5/);
  assert.match(program.judgeReason, /definitions\.ts:83-101/);
  assert.match(program.judgeReason, /effect\.token\.ts:341-342/);
  assert.match(program.judgeReason, /token-definition-or-abilities-judge-required/);
  assert.match(program.judgeReason, /UniversalPowerSource/);
  assert.match(program.judgeReason, /cost\.hidden/);
  assert.match(program.judgeReason, /entersExhausted/);
  assert.match(program.judgeReason, /bridge\.ts:228/);
  assert.match(program.judgeReason, /811\.1\.d\.2/);
  // These claims were disproved by the merged production sources and must not
  // survive as stale blockers.
  assert.doesNotMatch(program.judgeReason, /Invalid effect\.token argument: entersExhausted/);
  assert.doesNotMatch(program.judgeReason, /cost\.hidden has no layer mapping/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-070-221 Wages of Pain structure: Hidden + Action keywords, damage then exhausted Gold", () => {
  const keywords = program.abilities.filter((ability) => ability.kind === "keyword");
  assert.deepEqual(keywords, [
    { kind: "keyword", keyword: "hidden" },
    { kind: "keyword", keyword: "action" }
  ]);

  assert.equal(play.body.length, 2);
  assert.equal(dealInstruction.id, "deal-3");
  assert.equal(dealInstruction.op, "effect.damage");
  assert.deepEqual(dealInstruction.args.amount, { kind: "constant", value: 3 });
  assert.equal(dealInstruction.linkedTo, undefined);

  assert.deepEqual(dealInstruction.targets, [{
    id: "damaged-unit",
    filter: { type: "unit", location: "battlefield" },
    min: 1,
    max: 1,
    selection: "one"
  }]);

  assert.equal(tokenInstruction.id, "play-gold-token");
  assert.equal(tokenInstruction.op, "effect.token");
  assert.deepEqual(tokenInstruction.args.token, { kind: "constant", value: "gold" });
  assert.deepEqual(tokenInstruction.args.amount, { kind: "constant", value: 1 });
  assert.deepEqual(tokenInstruction.args.mode, { kind: "constant", value: "play" });
  assert.deepEqual(tokenInstruction.args.location, {
    kind: "constant",
    value: { type: "base", player: "controller" }
  });
  assert.deepEqual(tokenInstruction.args.entersExhausted, { kind: "constant", value: true });
  assert.equal(tokenInstruction.linkedTo, undefined);
  for (const instruction of [dealInstruction, tokenInstruction]) {
    assert.equal(instructionDefinitionsById.has(instruction.op), true, instruction.op);
  }
});

test("sfd-070-221 Wages of Pain: GameAction create-token carries the exhausted entry stipulation", () => {
  const kernel = world().player("A").unit("source").build();
  const actions = [];
  const choose = (request) => {
    throw new AwaitChoice(request);
  };
  const context = {
    ...kernel.clone({ sourceSnapshot: kernel.getObject("source"), controller: "A" }),
    evaluate: (expression) => expression.value,
    link: (key, value) => kernel.link(key, value),
    object: (ref) => {
      const object = kernel.objects.find((candidate) =>
        candidate.ref.id === ref.id && candidate.ref.zoneEntryId === ref.zoneEntryId);
      return object ?? null;
    },
    choose,
    perform: (action) => {
      actions.push(structuredClone(action));
      return kernel.perform(action);
    }
  };
  const result = token.execute(context, {
    token: { kind: "constant", value: "recruit" },
    amount: { kind: "constant", value: 1 },
    mode: { kind: "constant", value: "create" },
    location: { kind: "constant", value: { type: "base", player: "A" } },
    entersExhausted: { kind: "constant", value: true }
  });
  assert.equal(result.status, "executed");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "create-token");
  assert.equal(actions[0].token.exhausted, true);
  assert.equal(kernel.getObject("token-1").exhausted, true);
  assert.equal(actions[0].token.energy, null);
  assert.equal(actions[0].token.power, null);
});

test("sfd-070-221 Wages of Pain production golden: pays 3, damages a battlefield Unit, then fails closed on Gold", () => {
  const f = wagesScene();
  const draft = f.describe("wages");
  assert.equal(draft.kind, "spell");
  assert.equal(draft.speed, "action");

  f.engine.execute(draft);
  f.settle();

  assert.equal(f.kernel.player("A").energy, 0);
  assert.deepEqual(f.kernel.player("A").power, []);
  assert.equal(f.kernel.getObject("victim").damage, 3);
  assert.equal(f.kernel.getObject("base-only").damage, 0);
  assert.equal(f.kernel.getObject("wages").zone, "trash");
  assert.equal(f.targetRequests().length, 1);
  assert.deepEqual(f.targetRequests()[0].options, [f.kernel.ref("victim")]);

  const gold = f.kernel.linked("play-gold-token.goldToken");
  assert.equal(gold.amount, 0);
  assert.equal(gold.createdAmount, 0);
  assert.deepEqual(gold.objects, []);
  assert.equal(gold.objectsComplete, true);
  assert.equal(gold.blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(f.kernel.objects.some((object) => object.isToken), false);
  assert.deepEqual(
    f.kernel.events.map((event) => event.action).filter(Boolean),
    ["move-zone", "pay", "damage", "move-zone"]
  );
  const damageEvent = f.kernel.events.find((event) => event.action === "damage");
  assert.equal(damageEvent.reason, "damage");
  assert.equal(damageEvent.seq, 3);
  assert.equal(draft.cost.cost.kind, "printed");
  assert.equal(f.engine.trace.some((entry) => entry.step === "resolved"), true);
});

test("sfd-070-221 Wages of Pain production boundary: a target moved before Resolve is rechecked and ignored", () => {
  const f = wagesScene();
  f.engine.execute(f.describe("wages"));
  const moved = f.kernel.perform({
    type: "move-location",
    object: f.kernel.ref("victim"),
    to: { type: "base", player: "B" }
  });
  assert.equal(moved.status, "done");
  f.settle();

  assert.equal(f.kernel.getObject("victim").damage, 0);
  assert.equal(f.kernel.getObject("wages").zone, "trash");
  assert.equal(f.kernel.player("A").energy, 0);
  // The target was locked at Finalize. Moving it off the Battlefield before
  // Resolve makes the damage instruction mistarget; no damage result/link is
  // written at all, and no fallback target is selected.
  assert.equal(f.kernel.linked("deal-3"), undefined);
  assert.equal(
    f.kernel.linked("play-gold-token.goldToken").blockedReason,
    "token-definition-or-abilities-judge-required"
  );
});

test("sfd-070-221 Wages of Pain production boundary: no battlefield target fails before costs or movement", () => {
  const f = productionPlay({
    programs: [admittedProbeProgram],
    build: (builder) => builder
      .player("A", { energy: 3 })
      .player("B")
      .object("wages", {
        owner: "A", controller: "A", cardId: CARD_ID, name: "Wages of Pain",
        types: ["spell"], zone: "hand", energy: 3, power: null, might: null
      })
      .unit("base-only", {
        owner: "B", controller: "B", name: "Base-only unit", might: 5,
        location: { type: "base", player: "B" }
      })
  });
  const before = f.kernel.snapshot();
  const beforeEvents = structuredClone(f.kernel.events);
  assert.throws(
    () => f.play("wages"),
    (error) => error.name === "TargetSelectionError" && error.code === "no-legal-targets"
  );
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.kernel.events, beforeEvents);
  assert.equal(f.kernel.getObject("wages").zone, "hand");
});

test("sfd-070-221 Wages of Pain production boundary: insufficient Energy is rejected before the spell starts", () => {
  const f = wagesScene({ energy: 1 });
  const before = f.kernel.snapshot();
  const beforeEvents = structuredClone(f.kernel.events);
  assert.throws(
    () => f.play("wages"),
    (error) => error.name === "CostPlanError" && error.reason === "cannot-pay-cost"
  );
  assert.deepEqual(f.kernel.snapshot(), before);
  assert.deepEqual(f.kernel.events, beforeEvents);
  assert.equal(f.kernel.player("A").energy, 1);
  assert.equal(f.kernel.getObject("wages").zone, "hand");
});

test("sfd-070-221 Wages of Pain: Gold is defined but remains fail-closed before creation", () => {
  const gold = TOKEN_DEFINITIONS.find((definition) => definition.id === "gold");
  assert.ok(gold);
  assert.deepEqual(gold.spec.types, ["gear"]);
  assert.equal(gold.abilityBinding, "blocked");
  assert.equal(gold.blockedReason, "token-definition-or-abilities-judge-required");

  const kernel = world().build();
  const actions = [];
  const choose = (request) => { throw new AwaitChoice(request); };
  const context = {
    ...kernel.clone({ sourceSnapshot: kernel.getObject("source"), controller: "A" }),
    evaluate: (expression) => expression.value,
    link: (key, value) => kernel.link(key, value),
    object: (ref) => {
      const object = kernel.objects.find((candidate) =>
        candidate.ref.id === ref.id && candidate.ref.zoneEntryId === ref.zoneEntryId);
      return object ?? null;
    },
    choose,
    perform: (action) => {
      actions.push(structuredClone(action));
      return kernel.perform(action);
    }
  };
  const result = token.execute(context, tokenInstruction.args);
  assert.equal(result.status, "negated");
  assert.equal(result.reason, "impossible");
  assert.equal(kernel.linked("goldToken").blockedReason, "token-definition-or-abilities-judge-required");
  assert.equal(kernel.linked("goldToken").createdAmount, 0);
  assert.equal(actions.length, 0);
  assert.equal(kernel.objects.some((object) => object.isToken), false);
});

test("sfd-070-221 Wages of Pain: cost.hidden binds, while the live Hide transition has no production consumer", () => {
  const hidden = keywordDefinitionsById.get("Hidden");
  assert.ok(hidden, "effects/keywords/Hidden.ts must be registered");
  const [ability] = hidden.expand({ host: { canonicalCardId: CARD_ID } });
  assert.deepEqual(ability, { kind: "static", effect: { kind: "cost.hidden" } });
  const source = world()
    .player("A")
    .player("B")
    .hand("card", {
      cardId: CARD_ID,
      types: ["spell"],
      keywords: [{ id: "Hidden" }],
      energy: 3,
      power: null
    })
    .build();
  const { engine } = wagesScene();
  const binder = createEngineStaticBinder(engine);
  const handle = binder.bindStatic(ability, source.getObject("card"));
  assert.equal(typeof handle.unbind, "function");
  const registered = engine.layers.registry.get("program-hidden:card:1:0");
  assert.equal(registered.effect.effect.capabilityKind, "hidden");
  assert.equal(registered.effect.source.id, "card");
  // This capability is not itself a Hide action. bridge.ts rejects that action
  // and TurnFlow exposes no transition into its private sidecar.
  assert.equal(engine.layers.registry.list().length, 1);
});
