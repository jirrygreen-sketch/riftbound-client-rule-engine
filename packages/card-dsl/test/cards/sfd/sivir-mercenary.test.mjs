// 场景执行证据与整卡阻塞：../templates/keyword-static-static-649.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/sivir-mercenary.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import continuousMight from "../../../../engine-core/dist/effects/instructions/continuous.might.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import grantKeyword from "../../../../engine-core/dist/effects/instructions/continuous.grant-keyword.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import { createEngineStaticBinder, createProgramBinding, expandProgram } from "../../../../engine-core/dist/programs/index.js";
import { fixture } from "../../../../engine-core/test/chain/helpers.mjs";

const CARD_ID = "card.hash-bd07122c30b6cd8a4c4c84c4bcce0070fad8ea471344189ee61fb766cb54e888";
const SOURCE_TEXT =
  "[Accelerate] (You may pay :rb_energy_1::rb_rune_chaos: as an additional cost to have me enter ready.)\n" +
  "If you've spent at least :rb_rune_rainbow::rb_rune_rainbow: this turn, I have +2 :rb_might: and [Ganking]. (I can move from battlefield to battlefield.)";

const [accelerate, mightStatic, gankingStatic] = program.abilities;

test("sfd-143-221 Sivir, Mercenary: program validates and is registered by canonicalCardId", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(cardRegistryById.get(CARD_ID), program);
});

test("sfd-143-221 Sivir, Mercenary: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /135\.2\.e\.5\.a/);
  assert.match(program.judgeReason, /continuous\.might/);
  // The Might/grant execution sides are merged; the refreshed reason cites the
  // static-to-layer registration consumer, the missing spent/cost-receipt read,
  // the Ganking movement-permission gap and the unmapped accelerate.cost shape.
  assert.match(program.judgeReason, /spent/);
  assert.match(program.judgeReason, /evaluateCondition/);
  assert.match(program.judgeReason, /powerSpentThisTurn/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.match(program.judgeReason, /accelerate\.cost/);
  assert.match(program.judgeReason, /no layer mapping/);
  assert.match(program.judgeReason, /continuous\.might/);
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("sfd-143-221 Sivir, Mercenary: Accelerate keyword declared, never re-expanded in the card", () => {
  assert.equal(program.abilities.length, 3);
  // 805: the optional additional cost and the enter-ready replacement belong to
  // effects/keywords/Accelerate.ts (contract 3.7).
  assert.deepEqual(accelerate, { kind: "keyword", keyword: "accelerate" });
});

test("sfd-143-221 Sivir, Mercenary: the +2 Might half is a conditioned arithmetic-layer static ability", () => {
  assert.equal(mightStatic.kind, "static");
  // 143.2.a / 475-477: Might is altered in the arithmetic layer, never through a
  // Buff counter (702-704).
  assert.equal(mightStatic.effect.kind, "continuous.might");
  assert.equal(mightStatic.effect.mode, "add");
  assert.equal(mightStatic.effect.layer, "arithmetic");
  assert.equal(mightStatic.effect.appliesTo, "self");
  assert.deepEqual(mightStatic.effect.amount, { kind: "constant", value: 2 });

  // "If you've spent at least [A][A] this turn" — the recorded condition shape;
  // the turn's Power-spent amount has no read interface (see judgeReason).
  assert.equal(mightStatic.condition.kind, "compare");
  assert.equal(mightStatic.condition.operator, "gte");
  assert.deepEqual(mightStatic.condition.right, { kind: "constant", value: 2 });
  assert.deepEqual(mightStatic.condition.left, {
    kind: "object-property", object: "source", property: "powerSpentThisTurn"
  });
});

test("sfd-143-221 Sivir, Mercenary: the Ganking half is declared as a conditional keyword grant", () => {
  assert.equal(gankingStatic.kind, "static");
  // 810.1.b / 810.3: Ganking is a Passive Ability keyword; the grant is the
  // continuous.grant-keyword shape whose expansion lives in
  // effects/keywords/Ganking.ts (contract 3.7), not restated here.
  assert.equal(gankingStatic.effect.kind, "continuous.grant-keyword");
  assert.equal(gankingStatic.effect.appliesTo, "self");
  assert.deepEqual(gankingStatic.effect.keyword, { id: "Ganking" });
  // A passive grant is live while the source/condition applies, with no own turn expiry.
  assert.equal(gankingStatic.effect.duration, undefined);
  assert.equal(gankingStatic.condition.kind, "compare");
  assert.deepEqual(gankingStatic.condition.left, mightStatic.condition.left);
  assert.deepEqual(gankingStatic.condition.right, { kind: "constant", value: 2 });
});

test("sfd-143-221 Sivir, Mercenary: the merged arithmetic layer applies the declared +2 Might when registered", () => {
  // The merged layers engine executes the amount this card declares. The
  // "spent [A][A]" gate itself stays TODO (no merged spend read), so this run
  // registers the effect unconditionally the way a met condition would.
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const snapshot = kernel.getObject("sivir");
  const engine = createLayerEngine([snapshot], [
    {
      effect: {
        id: "sivir-mercenary.might",
        layer: "arithmetic",
        source: snapshot.ref,
        filter: { objectId: "sivir" },
        effect: { kind: "continuous.might", mode: "add", amount: { kind: "constant", value: 2 } }
      },
      duration: { type: "permanent" },
      timestamp: 1,
      sequence: 1
    }
  ]);
  assert.equal(engine.evaluate(snapshot.ref).might, 6);
  // 702-704: the declared +2 is a Might modification, not a Buff counter.
  assert.equal(kernel.getObject("sivir").buffs, 0);
});

test("sfd-143-221 Sivir, Mercenary: the merged continuous.might primitive registers the arithmetic effect this card declares", () => {
  // The merged continuous.might is the execution side the card was waiting for:
  // running the card's declared amount/mode through the real primitive records
  // one arithmetic-layer registration on the controller's source unit, and the
  // layers engine then evaluates the printed +2.
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const scoped = kernel.clone({
    source: kernel.ref("sivir"),
    sourceSnapshot: kernel.getObject("sivir")
  });

  const run = runInstruction(
    continuousMight,
    {
      amount: { kind: "constant", value: 2 },
      mode: { kind: "constant", value: "add" },
      appliesTo: { kind: "constant", value: "self" }
    },
    { world: scoped }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(scoped.continuousEffects.map((entry) => entry.effect.filter.objectId), ["sivir"]);
  assert.equal(scoped.continuousEffects[0].effect.effect.amount, 2);

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map((entry, index) => ({
    ...entry,
    timestamp: 1,
    sequence: index + 1
  })));
  assert.equal(engine.evaluate(kernel.ref("sivir")).might, 6);
  // 702-704: the +2 is a Might modification, never a Buff counter.
  assert.equal(kernel.getObject("sivir").buffs, 0);
});

test("sfd-143-221 Sivir, Mercenary: production static binding keeps the unresolved spend gate closed on a populated Board", () => {
  const { engine, kernel } = fixture({ cards: [
    { id: "sivir", cardId: CARD_ID, types: ["unit"], might: 4 },
    { id: "ally", types: ["unit"], might: 3 }
  ] });
  for (const id of ["sivir", "ally"]) {
    engine.commit({ type: "move-zone", object: kernel.ref(id), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  }
  // Exercise the production adapter with the original static declarations.
  // Extra objects must never stand in for Power-spent amounts.
  const binder = createEngineStaticBinder(engine);
  binder.bindStatic(mightStatic, kernel.getObject("sivir"));
  binder.bindStatic(gankingStatic, kernel.getObject("sivir"));
  const snapshot = engine.layers.snapshot(kernel.ref("sivir"));
  assert.equal(snapshot.might, 4);
  assert.equal(snapshot.keywords.some(keyword => keyword.id.toLowerCase() === "ganking"), false);
  assert.equal(snapshot.buffs, 0);
  assert.equal(kernel.events.some(event => event.action === "pay"), false);
});

test("sfd-143-221 Sivir, Mercenary: the production binder re-evaluates a supported compare against live source state", () => {
  const { engine, kernel } = fixture({ cards: [{ id: "sivir", cardId: CARD_ID, types: ["unit"], might: 4 }] });
  engine.commit({ type: "move-zone", object: kernel.ref("sivir"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  // A consumer control for compare support, using the card's Might effect and
  // an existing characteristic. This does not implement the printed spend gate.
  createEngineStaticBinder(engine).bindStatic({
    ...mightStatic,
    condition: {
      kind: "compare",
      left: { kind: "object-property", object: "self", property: "exhausted" },
      operator: "eq",
      right: { kind: "constant", value: true }
    }
  }, kernel.getObject("sivir"));
  assert.equal(engine.layers.snapshot(kernel.ref("sivir")).might, 4);
  engine.commit({ type: "exhaust", object: kernel.ref("sivir") });
  assert.equal(engine.layers.snapshot(kernel.ref("sivir")).might, 6);
  engine.commit({ type: "ready", object: kernel.ref("sivir") });
  assert.equal(engine.layers.snapshot(kernel.ref("sivir")).might, 4);
  assert.equal(kernel.getObject("sivir").buffs, 0);
});

test.todo(
  "sfd-143-221 Sivir, Mercenary: evaluate \"you've spent at least [A][A] this turn\" — no merged Expr reads " +
    "spent amounts this turn (ResolveContext exposes no spend receipt); source.powerSpentThisTurn is " +
    "an unresolved read position, and a missing read closes the bound condition (test above)"
);

test("sfd-143-221 Sivir, Mercenary: the shipped program remains judge-gated before lifecycle binding", () => {
  const binding = createProgramBinding({ cardPrograms: [program] });
  assert.throws(() => binding.registry.get(CARD_ID), error => error.code === "judge-required" && /spent/.test(error.message));
});

test.todo(
  "sfd-143-221 Sivir, Mercenary: grant [Ganking] for the turn through a continuous.grant-keyword consumer that the " +
    "movement system reads (810.1.b / 144.4.c.1) — the keyword/layer halves and the static registration consumer " +
    "have merged; what remains is the Ganking permission shape (the movement runtime reads permission.routes, " +
    "not the granted keyword string) and the spent-read condition from the first TODO"
);

// Direct evidence for the Ganking half: the merged keyword grant really writes
// the ability-layer keyword, but no movement permission is produced, so a
// Standard Move query still reports no Battlefield-to-Battlefield route.
test("sfd-143-221 Sivir, Mercenary: a granted Ganking keyword produces no movement permission (810.1.b/810.1.c)", () => {
  const kernel = world().unit("sivir", { might: 4, location: { type: "battlefield", id: "bf-1" } }).build();
  const scoped = kernel.clone({ source: kernel.ref("sivir"), sourceSnapshot: kernel.getObject("sivir") });
  const run = runInstruction(grantKeyword, {
    keyword: { kind: "constant", value: "Ganking" },
    appliesTo: { kind: "constant", value: "self" },
    duration: { kind: "constant", value: "this-turn" }
  }, { world: scoped });
  assert.equal(run.result.status, "executed");
  assert.deepEqual(scoped.continuousEffects.map(entry => entry.effect.effect.kind), ["continuous.grant-keyword"]);

  const engine = createLayerEngine(kernel.objects, scoped.continuousEffects.map((entry, index) => ({
    ...entry,
    timestamp: 1,
    sequence: index + 1
  })));
  const snapshot = engine.evaluate(kernel.ref("sivir"));
  // 478 / 810.3: the keyword really is on the object...
  assert.equal(snapshot.keywords.some(keyword => keyword.id.toLowerCase() === "ganking"), true);
  // ...but movement() reads permission.routes, which the keyword grant never
  // writes, so the printed Battlefield-to-Battlefield route is still absent.
  assert.equal(movement(engine.registry, kernel.ref("sivir"), snapshot, "A").canGank, false);
  assert.equal(movement(engine.registry, kernel.ref("sivir"), snapshot, "A").battlefieldToBattlefield, false);
});

// Direct evidence for the Accelerate half: the merged expansion declares
// accelerate.cost, but the card-side static binder has no layer for it, so the
// printed optional cost can never reach Finalize from the card's own data.
test("sfd-143-221 Sivir, Mercenary: the merged lifecycle binder rejects the accelerate.cost declaration (805.1.b)", () => {
  const lifted = { ...program, status: "executable", judgeReason: undefined };
  const snapshot = {
    ref: { id: "sivir", zoneEntryId: 1 },
    cardId: CARD_ID,
    name: "Sivir, Mercenary",
    types: ["unit"],
    tags: ["Sivir", "Shurima", "Champion"],
    keywords: [{ id: "Accelerate" }],
    owner: "A",
    controller: "A",
    zone: "board",
    location: { type: "base", player: "A" },
    might: 4,
    energy: 4,
    power: ["Chaos"],
    exhausted: false,
    damage: 0,
    stunned: false,
    buffs: 0,
    attachedTo: null,
    faceDown: false,
    isToken: false
  };
  const expanded = expandProgram(lifted, snapshot);
  const accelerate = expanded.abilities.find(ability => ability.kind === "static" && ability.effect.kind === "accelerate.cost");
  assert.ok(accelerate, "the merged Accelerate KeywordDef must declare accelerate.cost");

  const { engine, kernel } = fixture({ cards: [{ id: "sivir", cardId: CARD_ID, types: ["unit"], might: 4, keywords: [{ id: "Accelerate" }] }] });
  engine.commit({ type: "move-zone", object: kernel.ref("sivir"), to: "base", location: { type: "base", player: "A" } });
  assert.throws(
    () => createEngineStaticBinder(engine).bindStatic(accelerate, kernel.getObject("sivir")),
    (error) => {
      assert.equal(error.name, "ProgramBindingError");
      assert.match(error.message, /accelerate\.cost has no layer mapping/);
      return true;
    }
  );
  // The lifecycle path reports exactly that failure instead of silently
  // ignoring the printed cost.
  const binding = createProgramBinding({ cardPrograms: [lifted] });
  const errors = [];
  binding.attachLifecycle(engine, (error) => errors.push(error.message));
  engine.commit({ type: "move-zone", object: kernel.ref("sivir"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  assert.equal(errors.some(message => /accelerate\.cost has no layer mapping/.test(message)), true);
});

test.todo(
  "sfd-143-221 Sivir, Mercenary: paying the optional Accelerate cost [1][Chaos] and the enter-ready replacement " +
    "run through the whole card once its spent-read condition is implemented — the Finalize optionalAdditional " +
    "cost plan and Accelerate keyword expansion have merged; the shipped program stays judge-gated"
);
