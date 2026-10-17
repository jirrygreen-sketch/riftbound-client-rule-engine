import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/ir/validation.js";
import program from "../../../dist/cards/ogn/bilgewater-bully.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so the keyword/layer evidence below loads the built engine through
// its workspace layout instead of the package name.
const engineCore = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordRegistryById } = await import(new URL("effects/keywords/registry.generated.js", engineCore));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", engineCore));
const { createLayerEngine, ContinuousEffectRegistry } = await import(new URL("layers/index.js", engineCore));
const { movement } = await import(new URL("layers/rules/query.js", engineCore));
const grantKeyword = (await import(new URL("effects/instructions/continuous.grant-keyword.js", engineCore))).default;
const movementInstruction = (await import(new URL("effects/instructions/continuous.movement.js", engineCore))).default;
const { createEngineStaticBinder } = await import(new URL("programs/statics.js", engineCore));
const { fixture } = await import("../../../../engine-core/test/chain/helpers.mjs");

const CANONICAL = "card.hash-bfada85ea0485d763baf4f6d82594347175927b1b09ec1e1d976fce15710013e";
const [grantAbility] = program.abilities;
const literal = (value) => ({ kind: "constant", value });

const registryOf = (kernel) => {
  const registry = new ContinuousEffectRegistry();
  for (const entry of kernel.continuousEffects) registry.register(entry.effect, entry.duration);
  return registry;
};

test("Bilgewater Bully program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("Bilgewater Bully original static binding tracks gaining and spending a Buff on this host only", () => {
  const f = fixture({ cards: [{ id: "bully", types: ["unit"], might: 6, buffs: 0 }] });
  f.engine.commit({ type: "move-zone", object: f.kernel.ref("bully"), to: "battlefield", location: { type: "battlefield", id: "battlefield-1" } });
  f.engine.advance();
  const source = f.kernel.getObject("bully");
  const handle = createEngineStaticBinder(f.engine).bindStatic(grantAbility, source);
  const snapshot = () => { f.engine.layers.setObjects(f.kernel.objects); return f.engine.layers.snapshot(source.ref); };
  assert.deepEqual(snapshot().keywords, []);
  f.engine.commit({ type: "buff", object: source.ref, amount: 1 });
  assert.deepEqual(snapshot().keywords.map(({ id }) => id), ["Ganking"]);
  assert.equal(f.engine.layers.snapshot(f.kernel.ref("enemy")).keywords.length, 0);
  f.engine.commit({ type: "spend-buff", object: source.ref, amount: 1, player: "A" });
  assert.deepEqual(snapshot().keywords, []);
  handle.unbind();
  assert.equal(f.engine.layers.registry.list().length, 0);
});

test("identity: canonicalCardId, ruleset, status, judgeReason, verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /continuous\.grant-keyword/);
  assert.match(program.judgeReason, /continuous\.movement/);
  assert.match(program.judgeReason, /hasGanking/);
  assert.equal(
    program.sourceText,
    "While I'm buffed, I have [Ganking]. (I can move from battlefield to battlefield.)"
  );
});

test("structure: static conditional Ganking grant on the buffed host", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grantAbility.kind, "static");
  assert.equal(grantAbility.effect.kind, "continuous.grant-keyword");
  assert.equal(grantAbility.effect.keyword, "Ganking");
  assert.deepEqual(grantAbility.effect.filter, { object: "self" });
  // "While I'm buffed" — a conditional passive ability (CR 364.3), read as the
  // host's real buffs counter (CR 702 / 702.2.a).
  assert.deepEqual(grantAbility.condition, {
    kind: "compare",
    left: { kind: "object-property", object: "self", property: "buffs" },
    operator: "gte",
    right: { kind: "constant", value: 1 }
  });
  assert.equal(grantAbility.body, undefined);
});

test("golden: the granted Ganking reaches the ability layer and expires at end of turn", () => {
  // RIFT-258 merged continuous.grant-keyword; the card's own static grant is
  // driven through that primitive with the printed keyword and duration.
  const base = world().unit("bilgewater-bully", { owner: "A", buffs: 1 }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("bilgewater-bully") });
  const run = runInstruction(
    grantKeyword,
    { keyword: literal(grantAbility.effect.keyword), duration: literal("this-turn"), appliesTo: literal("self") },
    { world: kernel }
  );

  assert.equal(run.result.status, "executed");
  assert.equal(kernel.continuousEffects.length, 1);
  assert.deepEqual(kernel.continuousEffects[0].duration, { type: "end-of-turn" });
  const engine = createLayerEngine(
    [kernel.getObject("bilgewater-bully")],
    kernel.continuousEffects.map((entry, index) => ({ ...entry, timestamp: index + 1 }))
  );
  const ref = kernel.ref("bilgewater-bully");
  assert.ok(engine.evaluate(ref).keywords.some((keyword) => keyword.id === "Ganking"));
  engine.advance({ id: "turn-end" });
  assert.deepEqual(engine.evaluate(ref).keywords, []);
});

test("golden: the granted Ganking expands to the CR 810 movement permission", () => {
  const ganking = keywordRegistryById.get("Ganking");
  assert.ok(ganking, "effects/keywords/Ganking.ts must be registered");
  assert.equal(ganking.keyword, "Ganking");
  assert.equal(ganking.stacking, "single");
  assert.ok(ganking.ruleRefs.includes("810.1.c"), "810.1.c is the Standard Move permission rule Ganking expands");
  const expansion = ganking.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expansion.length, 1);
  assert.equal(expansion[0].kind, "static");
  assert.equal(expansion[0].effect.kind, "continuous.movement");

  // Drive the merged continuous.movement instruction with the expansion's own
  // permission fields; the layers/rules query reports the Ganking route.
  const base = world().unit("ganker", { owner: "A" }).build();
  const kernel = base.clone({ sourceSnapshot: base.getObject("ganker") });
  const effect = expansion[0].effect;
  const run = runInstruction(
    movementInstruction,
    {
      permission: literal(effect.permission),
      source: literal(effect.source),
      destination: literal(effect.destination),
      move: literal(effect.move),
      addsPermission: literal(true),
      appliesTo: literal({ object: "self" })
    },
    { world: kernel }
  );
  assert.equal(run.result.status, "executed");
  const result = movement(registryOf(kernel), kernel.ref("ganker"), kernel.getObject("ganker"), "A");
  assert.equal(result.canGank, true);
  assert.equal(result.battlefieldToBattlefield, true);
});

test.todo(
  "Bilgewater Bully: re-expand dynamically granted Ganking into a registered movement rule " +
    "(the continuous.movement instruction already normalizes permission strings into permission.routes) " +
    "and revoke the battlefield-to-battlefield Standard Move permission when the Buff is spent"
);
