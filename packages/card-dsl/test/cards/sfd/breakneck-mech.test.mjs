import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/breakneck-mech.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { bindResolveContext, createActionPipelineHost } from "../../../../engine-core/dist/events/action-adapter.js";
import { EventPipeline } from "../../../../engine-core/dist/events/pipeline.js";
import { createLayerEngine } from "../../../../engine-core/dist/layers/index.js";
import { createContinuousEffectRegistry } from "../../../../engine-core/dist/layers/duration.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";
import { bindReplacement } from "../../../../engine-core/dist/replacement/index.js";
import { movement } from "../../../../engine-core/dist/layers/rules/query.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";

const CARD_ID = "card.hash-cb2ea7576d42c76d8ecf8fa3cdb082f007639b144aecc69402230df6bcc131ab";
const SOURCE_TEXT =
  "Your Mechs have [Deflect] and [Ganking]. (Opponents must pay :rb_rune_rainbow: to choose us with a spell or ability. We can move from battlefield to battlefield.)\n" +
  "I enter ready if you control another Mech.";

const [grant, enterReady] = program.abilities;

/** Pipeline host over the reference kernel, as engine-core's chain tests build it. */
function pipelineFor(kernel) {
  const host = createActionPipelineHost({
    checkpoint: () => ({ state: kernel.snapshot(), links: kernel.clone() }),
    restore: (checkpoint) => { kernel.restore(checkpoint.state); kernel.copyLinkedFrom(checkpoint.links); },
    objects: () => kernel.objects,
    perform: (action) => kernel.perform(action),
    choose: (request) => { throw new Error(`unexpected choice request ${request.id}`); },
    // The chain's ResolveContext normalizes the static "self" controller
    // spelling to the ability controller and evaluates through the layer
    // filter; the reference kernel alone compares raw filter values.
    context: (source, controller, timingPoint) => bindResolveContext(kernel, {
      source,
      controller,
      timingPoint,
      query: (filter) => kernel.objects.filter((object) => matchesObjectFilter(
        Object.fromEntries(Object.entries(filter).map(([key, value]) => [
          key,
          key === "controller" && value === "self" ? controller : value
        ])),
        object
      ))
    }),
    testTrigger: () => true
  });
  return new EventPipeline(host, ["A", "B"], "A");
}

const bindDeps = (kernel, pipeline) => ({
  host: { object: (ref) => kernel.object(ref), objects: () => kernel.objects, context: () => kernel },
  pipeline
});

test("breakneck-mech program is registered and validates", () => {
  assert.ok(program, "breakneck-mech must be exported");
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
});

test("breakneck-mech judgeReason names the current Deflect, Ganking and entry-condition gaps", () => {
  assert.match(program.judgeReason, /Deflect/);
  assert.match(program.judgeReason, /Ganking/);
  assert.match(program.judgeReason, /target\.tax/);
  assert.match(program.judgeReason, /permission\.routes/);
  assert.match(program.judgeReason, /matchesEnterAction/);
  assert.match(program.judgeReason, /tag\/other|tag \/ other/);
  assert.match(program.judgeReason, /attachProgramLifecycle/);
  assert.match(program.judgeReason, /createEngineStaticBinder/);
  assert.ok(!/unmerged KeywordDef|keywords registry is empty/.test(program.judgeReason));
  assert.ok(!/RIFT-257|CardProgram binding|未合入/.test(program.judgeReason));
});

test("breakneck-mech structure: static grant + enter-ready replacement", () => {
  assert.equal(program.abilities.length, 2);

  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "grant-keyword");
  assert.deepEqual(grant.effect.keywords, ["Deflect", "Ganking"]);
  assert.deepEqual(grant.effect.filter, {
    type: "unit",
    tag: "Mech",
    controller: "controller",
    zone: "board"
  });
  assert.equal(grant.condition, undefined);

  // 359.2.c / 369.3 / 805.6: the entry orientation is replaced, so the body is
  // the entry action itself and names the entering source rather than a later
  // ready of an already-entered permanent.
  assert.equal(enterReady.kind, "replacement");
  assert.deepEqual(enterReady.replaces, {
    event: "object-enters-board",
    filter: { self: true, exhausted: true }
  });
  assert.deepEqual(enterReady.with.map((instruction) => [instruction.id, instruction.op]), [
    ["breakneck-mech.enter-ready", "effect.ready"]
  ]);
  assert.deepEqual(enterReady.with[0].args, {
    objects: { kind: "constant", value: { kind: "source" } }
  });
  assert.equal(enterReady.with[0].targets, undefined);
  assert.equal(enterReady.condition.kind, "compare");
  assert.equal(enterReady.condition.left.kind, "count");
  assert.deepEqual(enterReady.condition.left.filter, {
    tag: "Mech",
    controller: "controller",
    zone: "board",
    other: true
  });
  assert.equal(enterReady.condition.operator, "gte");
  assert.deepEqual(enterReady.condition.right, { kind: "constant", value: 1 });
});

test("breakneck-mech: both declared keywords expand through the merged registry", () => {
  const deflect = keywordDefinitionsById.get("Deflect");
  const ganking = keywordDefinitionsById.get("Ganking");
  assert.ok(deflect, "effects/keywords/Deflect.ts must be registered");
  assert.ok(ganking, "effects/keywords/Ganking.ts must be registered");

  // 809: Deflect expands to the static target tax consumed by the target plan.
  const [deflectAbility] = deflect.expand({ value: 1, host: { canonicalCardId: CARD_ID } });
  assert.equal(deflectAbility.kind, "static");
  assert.equal(deflectAbility.effect.kind, "target.tax");
  assert.deepEqual(deflectAbility.effect.value, { kind: "constant", value: 1 });

  // 810: Ganking expands to the battlefield-to-battlefield movement permission.
  const [gankingAbility] = ganking.expand({ host: { canonicalCardId: CARD_ID } });
  assert.equal(gankingAbility.kind, "static");
  assert.equal(gankingAbility.effect.kind, "continuous.movement");
  assert.equal(gankingAbility.effect.permission, "battlefield-to-battlefield");
});

test("breakneck-mech golden: the battlefield-to-battlefield permission is readable through the merged movement query", () => {
  // What the granted Ganking means (810.1.c: the unit may use a standard move
  // between battlefields) is consumed by the merged rules query as an
  // ability-layer continuous.movement registration whose permission lists the
  // routes. The query reports that route for the granted permanent and leaves
  // an ungranted unit without it.
  const kernel = world().player("A")
    .unit("mech", { tags: ["Mech"], might: 2 })
    .unit("other-unit", { might: 2 })
    .build();
  const registration = (id) => ({
    effect: {
      id: `breakneck-mech.movement:${id}`,
      layer: "ability",
      source: kernel.ref("mech"),
      filter: { objectId: id, zone: "board", zoneEntryId: kernel.ref(id).zoneEntryId },
      effect: {
        kind: "continuous.movement",
        permission: { routes: ["battlefield-to-battlefield"], move: "standard" }
      }
    },
    duration: { type: "permanent" },
    timestamp: 1
  });
  const registry = createContinuousEffectRegistry([registration("mech")]);

  const granted = movement(registry, kernel.ref("mech"), kernel.getObject("mech"), "A");
  assert.equal(granted.canGank, true);
  assert.equal(granted.battlefieldToBattlefield, true);
  assert.deepEqual(granted.permissions.map((permission) => permission.routes), [["battlefield-to-battlefield"]]);

  const ungranted = movement(registry, kernel.ref("other-unit"), kernel.getObject("other-unit"), "A");
  assert.equal(ungranted.canGank, false);
  assert.deepEqual(ungranted.permissions, []);
});

test("breakneck-mech golden: the granted keywords land on the controller's Mechs through the layer engine", () => {
  // The declared grant is a single ability-layer grant-keyword effect over the
  // controller's Mechs (802.2 style). The layer engine applies the grants to
  // exactly that set; the missing piece is the production registration path.
  const kernel = world().player("A")
    .unit("mech", { tags: ["Mech"], might: 2, controller: "A" })
    .unit("ally-non-mech", { tags: [], might: 2, controller: "A" })
    .unit("enemy-mech", { tags: ["Mech"], might: 2, owner: "B", controller: "B" })
    .build();
  const registration = {
    effect: {
      id: "breakneck-mech.grant",
      layer: "ability",
      source: kernel.ref("mech"),
      // 478 的 ability 图层按注册的 per-object 过滤器匹配；引擎的过滤器读
      // characteristics.tags 而不是顶层 tag 键（layers/filter.ts）。
      filter: { type: "unit", tags: ["Mech"], controller: "A", zone: "board" },
      effect: { kind: "continuous.grant-keyword", keywords: [{ id: "Deflect", value: 1 }, { id: "Ganking" }] }
    },
    duration: { type: "permanent" },
    timestamp: 1
  };
  const engine = createLayerEngine(kernel.objects, [registration]);

  assert.deepEqual(engine.evaluate(kernel.ref("mech")).keywords.map((keyword) => keyword.id).sort(), ["Deflect", "Ganking"]);
  assert.deepEqual(engine.evaluate(kernel.ref("ally-non-mech")).keywords, []);
  assert.deepEqual(engine.evaluate(kernel.ref("enemy-mech")).keywords, []);
});

/**
 * Drive the real play/entry path: the card moves hand -> chain, the resolver
 * lands the default exhausted orientation on the chain permanent (CR 805.6),
 * and the entry move carries it to a Board location.
 */
function enterBoard({ bind = true, otherMech = true } = {}) {
  const builder = world().player("A").hand("mech", { types: ["unit"], tags: ["Mech"], might: 2 });
  if (otherMech) builder.unit("other-mech", { tags: ["Mech"], might: 3, controller: "A" });
  const kernel = builder.build();
  const hostRef = kernel.ref("mech");
  const pipeline = pipelineFor(kernel);
  const bound = bind
    ? bindReplacement({ replaces: enterReady.replaces, with: enterReady.with, condition: enterReady.condition },
        hostRef, bindDeps(kernel, pipeline))
    : null;

  pipeline.commit({ type: "move-zone", object: hostRef, to: "chain" });
  pipeline.commit({ type: "exhaust", object: kernel.ref("mech") });
  const chainOrientation = kernel.getObject("mech").exhausted;
  pipeline.commit({
    type: "move-zone",
    object: kernel.ref("mech"),
    to: "base",
    location: { type: "base", player: "A" }
  });
  const object = kernel.getObject("mech");
  const result = {
    chainOrientation,
    zone: object.zone,
    location: object.location,
    exhausted: object.exhausted,
    readyTiming: pipeline.events.some((event) => event.timingPoint === "object-readied")
  };
  if (bound) bound.cancel();
  return result;
}

test("breakneck-mech golden: 'I enter ready' binds as a board-entry replacement, not a later ready", () => {
  const kernel = world().player("A")
    .unit("mech", { tags: ["Mech"], might: 2, zone: "chain", exhausted: true })
    .unit("other-mech", { tags: ["Mech"], might: 3, controller: "A" })
    .build();
  const pipeline = pipelineFor(kernel);

  const bound = bindReplacement({
    replaces: enterReady.replaces,
    with: enterReady.with,
    condition: enterReady.condition
  }, kernel.ref("mech"), bindDeps(kernel, pipeline));

  assert.equal(bound.registration.id, `replacement:mech:${kernel.ref("mech").zoneEntryId}`);
  // 370.3/370.4: a replacement is evaluated from its active zone, so the
  // binding stays active across zones (hand -> chain -> board).
  assert.deepEqual(bound.registration.activeZones, ["hand", "deck", "rune-deck", "trash", "banishment", "board", "rune-zone", "chain"]);
  // The declared body is accepted by the merged entry planner, which requires
  // the entering source selector for effect.ready.
  bound.cancel();
});

test("breakneck-mech golden: the entry replacement turns the default exhausted entry into a ready entry", () => {
  // 359.2.c: units enter exhausted by default; 369.3 / 805.6 let an entry
  // replacement choose the orientation. The comparison against the unbound run
  // is the evidence that the orientation comes from the declared replacement.
  const withoutCard = enterBoard({ bind: false });
  const withCard = enterBoard({ bind: true });

  assert.equal(withoutCard.chainOrientation, true);
  // 199.1: the permanent reaches the Board at the chosen Base location.
  assert.equal(withoutCard.zone, "board");
  assert.deepEqual(withoutCard.location, { type: "base", player: "A" });
  assert.equal(withoutCard.exhausted, true, "the default entry stays exhausted without the card");

  assert.equal(withCard.chainOrientation, true);
  assert.equal(withCard.zone, "board");
  assert.deepEqual(withCard.location, { type: "base", player: "A" });
  assert.equal(withCard.exhausted, false, "the declared entry replacement carries a ready orientation");
  // The orientation rides the entry move, so no separate "becomes ready"
  // timing point is emitted for the entering permanent.
  assert.equal(withCard.readyTiming, false);
});

test("breakneck-mech golden: the entry rewrite is gated by the declared 'another Mech' count", () => {
  // "if you control another Mech" is a programmatic object count, never a
  // choice (355.10.d), and `other: true` excludes the entering Mech itself.
  // The declaration is asserted here; the merged entry-orientation match does
  // not consult the ability condition yet (see the todo below), so the golden
  // does not claim the gate is enforced at match time.
  const condition = enterReady.condition;
  assert.equal(condition.kind, "compare");
  assert.equal(condition.operator, "gte");
  assert.deepEqual(condition.right, { kind: "constant", value: 1 });
  assert.equal(condition.left.kind, "count");
  assert.equal(condition.left.subject, "objects");
  assert.deepEqual(condition.left.filter, {
    tag: "Mech",
    controller: "controller",
    zone: "board",
    other: true
  });
});

test.todo(
  "breakneck-mech: derive the granted Deflect target.tax registration into a TargetTaxSpec the target " +
    "plan consumes (today only caller-supplied options.tax / taxAdapter exists, and chain/engine.ts " +
    "collects taxes without reading the layers)"
);

test.todo(
  "breakneck-mech: reconcile the Ganking expansion with the rules query — Ganking.ts emits " +
    "continuous.movement with a plain permission string while layers/rules/query.ts reads " +
    "permission.routes, so the granted keyword yields no battlefield-to-battlefield route (CR 810.1.c)"
);

test.todo(
  "breakneck-mech: evaluate the replacement condition on the entry path — replacement/bind.ts " +
    "matchesEnterAction returns before testCondition, so 'if you control another Mech' never gates the " +
    "entry rewrite (CR 371.1)"
);

test.todo(
  "breakneck-mech: give the condition's count query a consumer for the singular tag/other keys — " +
    "layers/filter.ts silently ignores 'tag' and 'other', so 'another Mech' cannot be counted correctly"
);
