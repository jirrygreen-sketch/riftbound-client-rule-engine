import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/unl/enthusiastic-promoter.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { runInstruction, world } from "../../../../engine-core/dist/effects/testing/index.js";
import buff from "../../../../engine-core/dist/effects/instructions/effect.buff.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";

const CANONICAL_ID =
  "card.hash-c887e5d6b316e9709bd403596c8e7217fa050f03dc482385655b7654202cea8d";
const SOURCE_TEXT =
  "[Backline] (I must be assigned combat damage last.)\n" +
  "When I hold, [Buff] all units here. (Give each a +1 :rb_might: buff if it doesn't have one.)";
const BATTLEFIELD = { type: "battlefield", id: "battlefield-1" };

const [backline, onHold] = program.abilities;
const [buffHere] = onHold.body;
const targetSpec = buffHere.targets[0];

test("unl-043-219 Enthusiastic Promoter: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.deepEqual(result.issues, []);
  assert.equal(result.ok, true);
});

test("unl-043-219 Enthusiastic Promoter: identity, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // The remaining gaps after the dependency merge: no continuous.combat
  // consumer, no held-unit payload on the scoring wave, and no sameLocationAs
  // anchor in the card-program filter translation.
  assert.match(program.judgeReason, /826\.3/);
  assert.match(program.judgeReason, /base-combat-allocation/);
  assert.match(program.judgeReason, /383\.4\.d\.2/);
  assert.match(program.judgeReason, /sameLocationAs/);
  assert.match(program.judgeReason, /RIFT-31\/33/);
  // The stale keyword-expansion gap (RIFT-91) is removed: programs/keywords.ts
  // supplies the CardProgram -> KeywordDef expansion.
  assert.doesNotMatch(program.judgeReason, /RIFT-91/);
});

test("unl-043-219 Enthusiastic Promoter: [Backline] is a keyword declaration only", () => {
  assert.equal(program.abilities.length, 2);
  // 826.3 / 826.5: Backline carries no value and multiple instances are redundant.
  assert.deepEqual(backline, { kind: "keyword", keyword: "backline" });
  assert.equal(backline.value, undefined);
  // 826.4: the assignment requirement is expanded by the merged KeywordDef.
  const backlineDef = keywordDefinitionsById.get("Backline");
  assert.ok(backlineDef, "the merged Backline KeywordDef is registered (CR 826)");
  assert.equal(backlineDef.stacking, "single");
  const [expansion] = backlineDef.expand({ host: { canonicalCardId: CANONICAL_ID } });
  assert.equal(expansion.effect.kind, "continuous.combat");
  assert.equal(expansion.effect.priority, "last");
});

test("unl-043-219 Enthusiastic Promoter: the hold trigger subscribes to the hold timing point for the source", () => {
  assert.equal(onHold.kind, "triggered");
  // 383.4.d.1’s "When I hold…" spelling; the hold timing point is emitted by
  // the scoring wave (315.2.b.2 / 471.2 / 473.2.b).
  assert.deepEqual(onHold.trigger, { at: "hold", filter: { event: "held", filter: { source: "self" } } });
  assert.equal(onHold.optional, false);
  assert.equal(onHold.body.length, 1);
});

test("unl-043-219 Enthusiastic Promoter: the merged keyword expansion produces continuous.combat", () => {
  // expandProgram turns the declared [Backline] keyword into the merged
  // continuous.combat static ability. The hold body remains separately judged
  // because programs/filters.ts still rejects the sameLocationAs anchor.
  const binding = createProgramBinding({ cardPrograms: [program] });
  const source = {
    ref: { id: "promoter", zoneEntryId: 1 }, cardId: CANONICAL_ID, name: "Enthusiastic Promoter",
    types: ["unit"], tags: [], keywords: [], owner: "A", controller: "A", zone: "board",
    location: BATTLEFIELD, might: 2, energy: 3, power: null, exhausted: false, damage: 0,
    stunned: false, buffs: 0, attachedTo: null, faceDown: false, isToken: false, combatRole: null
  };
  const expanded = binding.inspect(source).abilities;
  assert.deepEqual(expanded.map((ability) => ability.kind), ["keyword", "triggered", "static"]);
  assert.equal(expanded[2].effect.kind, "continuous.combat");
});

test("unl-043-219 Enthusiastic Promoter golden: Buff lands on every unit here and skips one that already has a Buff", () => {
  const kernel = world()
    .unit("promoter", { zone: "board", location: BATTLEFIELD, might: 2, buffs: 0 })
    .unit("ally-here", { zone: "board", location: BATTLEFIELD, buffs: 0 })
    .unit("already-buffed", { zone: "board", location: BATTLEFIELD, buffs: 1 })
    .unit("ally-elsewhere", { zone: "board", location: { type: "base", player: "A" }, buffs: 0 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("promoter")) });
  // Finalize locks every unit at the same location (production re-verifies the
  // sameLocationAs anchor through the interpreter selector).
  ctx.setTargets(targetSpec.id, [ctx.ref("promoter"), ctx.ref("ally-here"), ctx.ref("already-buffed")]);
  const outcome = resolveChainBody(onHold.body, ctx);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["enthusiastic-promoter.buff-units-here", "executed"]
  ]);
  assert.equal(ctx.getObject("promoter").buffs, 1);
  assert.equal(ctx.getObject("ally-here").buffs, 1);
  // 702.3 / 702.3.a: an already-Buffed unit gets nothing but stays legal (427.1.c).
  assert.equal(ctx.getObject("already-buffed").buffs, 1);
  assert.equal(ctx.getObject("ally-elsewhere").buffs, 0);
  assert.deepEqual(ctx.events.map((event) => event.action), ["buff", "buff"]);
});

test("unl-043-219 Enthusiastic Promoter golden: with every candidate already buffed the instruction is a no-op", () => {
  const kernel = world()
    .unit("promoter", { zone: "board", location: BATTLEFIELD, buffs: 1 })
    .unit("ally-here", { zone: "board", location: BATTLEFIELD, buffs: 1 })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("promoter")) });
  const run = runInstruction(
    buff,
    { mode: "buff", target: targetSpec.id },
    { world: ctx, targets: { [targetSpec.id]: [ctx.ref("promoter"), ctx.ref("ally-here")] } }
  );
  // 702.3.a / 427.1.c: nothing was placed, so the instruction settles as skipped.
  assert.equal(run.result.status, "negated");
  assert.equal(run.result.reason, "skipped");
  assert.equal(run.linked.buffedCount, 0);
  assert.deepEqual(run.events, []);
});

test("unl-043-219 Enthusiastic Promoter golden: a stale locked group is mistargeted instead of silently skipped", () => {
  // 359.3.e.5–e.7: every locked reference is gone at resolution, so the
  // instruction is ignored(mistargeted) rather than reporting a no-op.
  const kernel = world()
    .unit("promoter", { zone: "board", location: BATTLEFIELD })
    .unit("ally-here", { zone: "board", location: BATTLEFIELD })
    .build();
  const ctx = kernel.clone({ sourceSnapshot: kernel.object(kernel.ref("promoter")) });
  const stale = ctx.ref("ally-here");
  ctx.perform({ type: "kill", object: stale });
  const run = runInstruction(
    buff,
    { mode: "buff", target: targetSpec.id },
    { world: ctx, targets: { [targetSpec.id]: [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.deepEqual(run.events, []);
});

test.todo(
  "unl-043-219 Enthusiastic Promoter: honour [Backline] when assigning combat damage (CR 826.3/826.4.a/826.4.b) — " +
    "the KeywordDef is present but the continuous.combat declaration still has no player: " +
    "combat/base-combat-allocation.ts records 'No Tank/Backline/other assignment-priority requirement is bound here'"
);
test.todo(
  "unl-043-219 Enthusiastic Promoter: bind the hold trigger to the unit present at the held battlefield " +
    "(CR 383.4.d.2/.2.a) — the scoring wave carries only player + details.battlefieldId (RIFT-31/RIFT-33)"
);
test.todo(
  "unl-043-219 Enthusiastic Promoter: bind the authored hold body as written — programs/filters.ts rejects the " +
    "'sameLocationAs' anchor key (CR 053.3 'here'), so no production TriggerRegistration can carry this body"
);
