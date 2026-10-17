import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/revna-the-lorekeeper.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import ganking from "../../../../engine-core/dist/effects/keywords/Ganking.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { ContinuousEffectRegistry } from "../../../../engine-core/dist/layers/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/index.js";

const CANONICAL_ID =
  "card.hash-5d3fba8de73d7d55f79675ba2f61ea15aa7cde6f01ba1f7e39f3e3dbffcaa6b8";
const SOURCE_TEXT =
  "[Ganking] (I can move from battlefield to battlefield.)\n" +
  "When you play a spell, if you spent :rb_energy_4: or more, ready me.";

const [keyword, triggered] = program.abilities;
const [readySelf] = triggered.body;

test("unl-005-219 Revna the Lorekeeper: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-005-219 Revna the Lorekeeper: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.match(program.judgeReason, /energy_4|Energy/);
  assert.match(program.judgeReason, /383\.2\.a\.1/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /RIFT-89/);
  // The Ganking half is no longer "no KeywordDef": the expansion exists and so do
  // the continuous.movement consumers; the remaining gap is the shape mismatch
  // plus the missing card-program -> layers registration (RIFT-257).
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /routes/);
  assert.match(program.judgeReason, /RIFT-257/);
  // Second-sweep refresh proof: the HistoryQuery field whitelist is named as the
  // real expression gap instead of a generic unmerged-history claim.
  assert.match(program.judgeReason, /HistoryQuery/);
});

test("unl-005-219 Revna the Lorekeeper: Ganking keyword plus a card-played spell trigger", () => {
  assert.equal(program.abilities.length, 2);
  // 810.1 / 810.1.a: Ganking is a Passive Ability keyword on Units with no value.
  assert.deepEqual(keyword, { kind: "keyword", keyword: "ganking" });
  assert.equal(keyword.value, undefined);

  // 383.4.a.4: an ability that triggers when another object is played is not a
  // Play Effect; it subscribes to card-played with the played Spell as the event
  // object (355.9.a.2) and the ability's controller as the player (190.6.d).
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    object: { type: "spell", controller: "self" },
    player: "self"
  });
  // 383.2.a.1: the trailing "if you spent [4] or more" belongs to the trigger
  // condition, not to an instruction inside the body.
  assert.equal(triggered.trigger.condition.kind, "compare");
  assert.equal(triggered.trigger.condition.operator, "gte");
  assert.deepEqual(triggered.trigger.condition.right, { kind: "constant", value: 4 });
  assert.equal(triggered.trigger.condition.left.kind, "count");
  assert.equal(triggered.trigger.condition.left.subject, "energy-spent-on-the-played-spell");
  assert.equal(triggered.optional, false);
});

test("unl-005-219 Revna the Lorekeeper: 'ready me' is a source-bound effect.ready instruction", () => {
  assert.deepEqual(triggered.body.map(instruction => instruction.id), ["revna-the-lorekeeper.ready-self"]);
  assert.equal(readySelf.op, "effect.ready");
  // 416.1 / 359.3.f.1: "me" is the ability's own source, expressed with the
  // contract 3.6 symbolic selector rather than a runtime ObjectRef.
  assert.deepEqual(readySelf.args.objects, { kind: "constant", value: { kind: "source" } });
  assert.deepEqual(readySelf.args.linkKey, { kind: "constant", value: "readied" });
  assert.equal(readySelf.targets, undefined);
  assert.equal(readySelf.picks, undefined);
  assert.equal(readySelf.linkedTo, undefined);
});

test("unl-005-219 Revna the Lorekeeper: the declared Ganking keyword resolves to the merged KeywordDef", () => {
  const registered = keywordDefinitionsById.get("Ganking");
  assert.ok(registered, "effects/keywords/Ganking.ts must be in the generated keyword registry");
  assert.equal(registered, ganking);
  assert.equal(keyword.keyword, registered.keyword.toLowerCase());
  // 810.2: multiple Ganking instances are redundant.
  assert.equal(registered.stacking, "single");
  assert.ok(registered.ruleRefs.includes("810.1"));
  assert.ok(registered.ruleRefs.includes("810.1.c"));
});

test("unl-005-219 Revna the Lorekeeper: the Ganking expansion is a battlefield-to-battlefield movement permission", () => {
  const [ability] = ganking.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.movement");
  assert.equal(ability.effect.permission, "battlefield-to-battlefield");
  assert.equal(ability.effect.source, "battlefield");
  assert.equal(ability.effect.destination, "battlefield");
  assert.equal(ability.effect.move, "standard");
  assert.equal(ability.effect.addsPermission, true);
});

test("unl-005-219 Revna the Lorekeeper: the merged movement() reader consumes a registered battlefield-to-battlefield permission", () => {
  // layers/rules/query.ts movement() reads the normalized permission.routes shape
  // the merged continuous.movement instruction emits; this is the consumer the
  // Ganking permission has to reach.
  const kernel = world()
    .unit("revna", { zone: "board", controller: "A", location: { type: "battlefield", id: "bf-1" } })
    .build();
  const snapshot = kernel.getObject("revna");
  const asRegistration = effect => ({
    id: "ganking",
    layer: "ability",
    source: snapshot.ref,
    filter: { objectId: snapshot.ref.id },
    effect
  });
  const registry = new ContinuousEffectRegistry();
  registry.register(
    asRegistration({
      kind: "movement",
      permission: {
        routes: ["battlefield-to-battlefield"],
        source: "battlefield",
        destination: "battlefield",
        move: "standard"
      }
    }),
    { type: "permanent" }
  );
  const consumed = movement(registry, snapshot.ref, snapshot, "A");
  assert.equal(consumed.canGank, true);
  assert.equal(consumed.battlefieldToBattlefield, true);
  assert.deepEqual(consumed.permissions.map((permission) => permission.routes), [
    ["battlefield-to-battlefield"]
  ]);
  // The Ganking expansion and the consumer describe the same route; the gap is
  // the declaration spelling, which is recorded in judgeReason and below.
  const [expansion] = ganking.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.effect.kind, "continuous.movement");
  assert.equal(expansion.effect.permission, "battlefield-to-battlefield");
});

test("unl-005-219 Revna the Lorekeeper: the trigger body readies the source unit (CR 416.1)", () => {
  const kernel = world()
    .unit("revna", { zone: "board", controller: "A", exhausted: true, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("revna")) });
  const outcome = resolveChainBody(triggered.body, scoped);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map(entry => [entry.id, entry.result.status]), [
    ["revna-the-lorekeeper.ready-self", "executed"]
  ]);
  assert.deepEqual(scoped.events.map(event => event.action), ["ready"]);
  assert.equal(scoped.object(scoped.ref("revna")).exhausted, false);
});

test("unl-005-219 Revna the Lorekeeper: an already-ready source produces no extra ready action (CR 416.1.b/c)", () => {
  const kernel = world()
    .unit("revna", { zone: "board", controller: "A", exhausted: false, location: { type: "battlefield", id: "bf-1" } })
    .build();
  const scoped = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("revna")) });
  const outcome = resolveChainBody(triggered.body, scoped);
  assert.equal(outcome.status, "executed");
  assert.equal(outcome.results[0].result.status, "executed");
  assert.equal(outcome.results[0].result.linkedValues.readied.count, 0);
  assert.deepEqual(outcome.events, []);
});

test("unl-005-219 Revna the Lorekeeper: the generated card registry exposes the program under its canonical id", () => {
  assert.equal(cardRegistryById.get(CANONICAL_ID), program);
});

test.todo(
  "unl-005-219 Revna the Lorekeeper: evaluate 'if you spent :rb_energy_4: or more' against the Energy actually paid for " +
    "the played spell (CR 383.2.a.1) — merged Expr/Condition has no spent-amount read and the frozen HistoryQuery counts " +
    "actions, not amounts (RIFT-89 cost receipt)"
);

test.todo(
  "unl-005-219 Revna the Lorekeeper: grant the battlefield-to-battlefield Standard Move from the merged Ganking " +
    "expansion (CR 810.1.b / 810.1.c.1, 144.4.c) once the KeywordDef's scalar permission/source/destination/move " +
    "declaration reaches movement()'s normalized permission.routes reader and RIFT-257 registers a card's keyword " +
    "abilities through layers"
);

test.todo(
  "unl-005-219 Revna the Lorekeeper: fire the card-played spell trigger from the real chain flow (CR 383.4.a.4 / 420.4.a) — " +
    "the CardProgram -> TriggerRegistration adapter is the RIFT-120 follow-up"
);
