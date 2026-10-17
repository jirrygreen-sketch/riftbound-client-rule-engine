// Golden test for Spinning Axe (sfd-186-221).
//
// The program declares keyword identities only (contract 3.1 / 3.7). The two
// merge-verified halves are the Quick-Draw expansion's attach body and the Equip
// expansion's attach body; both run through the production interpreter adapter
// with a Finalize-locked target. Temporary, the Equip cost pipeline and the
// card-played source identity are the judged gaps (see judgeReason).
import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/spinning-axe.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import { resolveChainBody } from "../../../../engine-core/dist/chain/interpreter-adapter.js";
import { bindResolveContext } from "../../../../engine-core/dist/events/action-adapter.js";
import { matchesTriggerEvent } from "../../../../engine-core/dist/events/pipeline-match.js";
import { validateTriggerSpec } from "../../../../engine-core/dist/events/trigger-spec.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";
import { createProgramBinding } from "../../../../engine-core/dist/programs/index.js";
import { world } from "../../../../engine-core/dist/effects/testing/index.js";
import { matchesObjectFilter } from "../../../../engine-core/dist/layers/filter.js";

const CARD_ID =
  "card.hash-800c2a2c210066550ce1c729596dd3e463d221242fece59853f3a3983e3023b4";
const SOURCE_TEXT =
  "[Quick-Draw] (This has [Reaction]. When you play it, attach it to a unit you control.)\n" +
  "[Equip] :rb_rune_rainbow: (:rb_rune_rainbow:: Attach this to a unit you control.)\n" +
  "[Temporary] (If this is unattached, kill it at the start of its controller's Beginning Phase, before scoring.)";
const HOST = { canonicalCardId: CARD_ID };

const [quickDraw, equip, temporary] = program.abilities;

const axeWorld = () => world()
  .object("spinning-axe", {
    name: "Spinning Axe",
    cardId: CARD_ID,
    types: ["gear"],
    tags: ["Draven", "Equipment", "Signature"],
    keywords: [{ id: "Quick-Draw" }, { id: "Equip", value: 1 }, { id: "Temporary" }],
    zone: "board",
    location: { type: "base", player: "A" },
    energy: 2,
    power: null,
    might: 3,
    controller: "A",
    owner: "A"
  })
  .unit("ally", { might: 3, location: { type: "battlefield", id: "battlefield-1" } })
  .unit("foe", {
    might: 3,
    controller: "B",
    owner: "B",
    location: { type: "battlefield", id: "battlefield-1" }
  })
  .build();

/**
 * Execute an expansion body with its Finalize-locked answer, exactly as the
 * production chain supplies it: the host/source is the axe's live reference, the
 * TargetPlan answer is already chosen, and target re-verification runs the
 * production matcher (which binds the contract's `controller: "self"`
 * placeholder to the ability controller instead of comparing it literally).
 */
const productionQuery = (kernel) => (filter) => kernel.objects.filter((object) => matchesObjectFilter(
  Object.fromEntries(Object.entries(filter).map(([key, value]) => [key, value === "self" ? "A" : value])),
  object
));

const runExpansionBody = (body, targetSpecId, chooseTarget) => {
  const kernel = axeWorld();
  const bound = bindResolveContext(kernel, {
    // ResolveContext.source is the ability source's ObjectSnapshot; effect.attach
    // reads ctx.source.ref from it (the axe itself, not a synthetic source).
    source: kernel.getObject("spinning-axe"),
    sourceSnapshot: kernel.getObject("spinning-axe"),
    controller: "A",
    query: productionQuery(kernel)
  });
  const refs = chooseTarget ? [chooseTarget(kernel)] : [];
  kernel.setTargets(targetSpecId, refs);
  return { kernel, refs, outcome: resolveChainBody(body, bound) };
};

test("sfd-186-221 Spinning Axe: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-186-221 Spinning Axe: identity, ruleset, status, judgeReason and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CARD_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CARD_ID), program);

  // README section 2: the reason names the missing keyword/primitive/rule and
  // the dependent work, not a generic "needs support".
  assert.match(program.judgeReason, /Temporary/);
  assert.match(program.judgeReason, /816\.1\.b/);
  assert.match(program.judgeReason, /163\.2\.b/);
  // The Temporary KeywordDef and the CardProgram binding have merged since the
  // original note; the refreshed reason points at the EventPattern vocabulary
  // (beginning-start), the in-progress cost work and the event source payload.
  assert.match(program.judgeReason, /RIFT-39/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.equal(program.judgeReason.includes("无已合入 KeywordDef"), false);
});

test("sfd-186-221 Spinning Axe: three keyword declarations in printed order", () => {
  assert.equal(program.abilities.length, 3);
  assert.deepEqual(quickDraw, { kind: "keyword", keyword: "quick-draw" });
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  // 818.1.c.2: the printed Equip cost is one :rb_rune_rainbow: symbol.
  assert.equal(equip.value, 1);
  // [A] is Universal Power (135.2.e.5 / 163.2.b); the descriptive spelling
  // records the printing without narrowing it to one of the six named domains.
  assert.equal(equip.costDomain, "rainbow");
  for (const domain of ["Fury", "Calm", "Mind", "Body", "Chaos", "Order"]) {
    assert.equal(equip.costDomain === domain, false);
  }
  assert.deepEqual(temporary, { kind: "keyword", keyword: "temporary" });
});

test("sfd-186-221 Spinning Axe: the declared Quick-Draw and Equip expansions are valid EffectIR here", () => {
  // 819.1.d: Quick-Draw = inherent Reaction + a play trigger that attaches.
  const quickDrawExpansion = keywordDefinitionsById.get("Quick-Draw").expand({ host: HOST });
  assert.deepEqual(quickDrawExpansion.map((ability) => ability.kind), ["static", "triggered"]);
  // 818.1.c.2: Equip = "[cost]: attach this gear to a unit you control".
  const equipExpansion = keywordDefinitionsById.get("Equip").expand({ host: HOST });
  assert.deepEqual(equipExpansion.map((ability) => ability.kind), ["activated"]);

  const expanded = validateCardProgram({
    canonicalCardId: CARD_ID,
    rulesetVersion: EFFECT_IR_V2_RULESET,
    status: "executable",
    abilities: [...quickDrawExpansion, ...equipExpansion],
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.equal(expanded.ok, true);
});

test("sfd-186-221 golden: the Quick-Draw trigger attaches the axe to a locked unit you control", () => {
  const triggered = keywordDefinitionsById.get("Quick-Draw").expand({ host: HOST })[1];
  assert.equal(triggered.trigger.at, "card-played");
  assert.equal(triggered.optional, false);
  // 819.1.d reminder: "attach it to a unit you control".
  assert.deepEqual(triggered.body[0].targets, [
    { id: "quick-draw-unit", filter: { type: "unit", controller: "self" }, min: 1, max: 1, selection: "one" }
  ]);

  // A locked ally: the real attach action runs and records the attachment.
  const attached = runExpansionBody(triggered.body, "quick-draw-unit", (kernel) => kernel.ref("ally"));
  assert.equal(attached.outcome.status, "executed");
  assert.deepEqual(attached.outcome.results.map((result) => [result.id, result.result.status]), [
    ["quick-draw-attach", "executed"]
  ]);
  assert.deepEqual(attached.kernel.getObject("spinning-axe").attachedTo, attached.kernel.ref("ally"));
  assert.deepEqual(attached.outcome.events.map((event) => event.action), ["attach"]);

  // No legal locked target: the attach is mistargeted (ignored), the gear stays unattached.
  const mistargeted = runExpansionBody(triggered.body, "quick-draw-unit", null);
  assert.equal(mistargeted.outcome.status, "partial");
  assert.equal(mistargeted.outcome.results[0].result.status, "ignored");
  assert.equal(mistargeted.outcome.results[0].result.reason, "mistargeted");
  assert.equal(mistargeted.kernel.getObject("spinning-axe").attachedTo, null);
});

test("sfd-186-221 golden: the Equip body attaches the axe to a locked unit you control", () => {
  const activation = keywordDefinitionsById.get("Equip").expand({ host: HOST })[0];
  assert.equal(activation.timing, "action");
  assert.deepEqual(activation.cost.payments.map((payment) => payment.kind), ["equip"]);
  // 818.1.b.1 / 818.1.c.2: the chosen unit is a Target restricted to units you control.
  assert.deepEqual(activation.body[0].targets, [
    { id: "equip-target", filter: { type: "unit", controller: "self" }, min: 1, max: 1, selection: "one" }
  ]);

  const attached = runExpansionBody(activation.body, "equip-target", (kernel) => kernel.ref("ally"));
  assert.equal(attached.outcome.status, "executed");
  assert.deepEqual(attached.outcome.results.map((result) => [result.id, result.result.status]), [
    ["equip-attach", "executed"]
  ]);
  assert.deepEqual(attached.kernel.getObject("spinning-axe").attachedTo, attached.kernel.ref("ally"));
  // effect.attach links { count, objects, host } under the default "attached" key.
  assert.equal(attached.outcome.linkedValues["equip-attach.attached"].count, 1);
  assert.equal(attached.outcome.linkedValues["equip-attach.attached"].host.id, "ally");
});

test("sfd-186-221 golden: the merged Temporary expansion kills the axe through the real effect.kill primitive", () => {
  // 816.1.b/816.1.c: at the start of the controller's Beginning Phase, before
  // scoring, kill this permanent. The KeywordDef is merged and its body uses the
  // merged effect.kill primitive, so the body itself executes; what the
  // EventPattern vocabulary still blocks is the beginning-start subscription.
  const [temporaryTriggered] = keywordDefinitionsById.get("Temporary").expand({ host: HOST });
  assert.equal(temporaryTriggered.trigger.at, "beginning-start");
  assert.deepEqual(temporaryTriggered.trigger.filter, { event: "beginning-start", player: "self" });

  const kernel = axeWorld();
  const bound = bindResolveContext(kernel, {
    source: kernel.getObject("spinning-axe"),
    sourceSnapshot: kernel.getObject("spinning-axe"),
    controller: "A",
    query: productionQuery(kernel)
  });
  const outcome = resolveChainBody(temporaryTriggered.body, bound);
  assert.equal(outcome.status, "executed");
  assert.deepEqual(outcome.results.map((result) => [result.id, result.result.status]), [
    ["temporary:card.hash-800c2a2c210066550ce1c729596dd3e463d221242fece59853f3a3983e3023b4:kill", "executed"]
  ]);
  assert.equal(kernel.getObject("spinning-axe").zone, "trash");
  assert.deepEqual(outcome.events.map((event) => event.action), ["kill"]);

  // The subscription spec is where the merged path stops: the closed
  // EventPattern vocabulary must contain the printed timing point, and any
  // rejection must concern only the event-name vocabulary (never a rewritten
  // timing point or a widened filter). This keeps passing once the vocabulary
  // lands.
  const validation = validateTriggerSpec(temporaryTriggered.trigger);
  if (!validation.ok) {
    assert.deepEqual([...new Set(validation.issues.map((issue) => issue.code))], ["invalid-event-type"]);
  }
  assert.equal(temporaryTriggered.trigger.at, "beginning-start");
});

test("sfd-186-221 golden: the merged binding layer registers the Quick-Draw card-played trigger for this card", () => {
  // Durable contract (RIFT-257 programs/triggers.ts + the merged Quick-Draw
  // KeywordDef): the expansion's card-played trigger must be registered for the
  // axe with its source discriminator bound to this card's printed identity, so
  // it fires for the axe's own play and not for other cards. The production
  // card-played event still carries object/player only, so the discriminator
  // cannot match until that payload lands (see judgeReason).
  const lifted = { ...program, status: "executable" };
  delete lifted.judgeReason;
  const bound = createProgramBinding({ cardPrograms: [lifted] });
  const registrations = [];
  bound.registerProgramTriggers(
    { pipeline: { registerTrigger: (registration) => registrations.push(registration), unregisterTrigger: () => {} } },
    {
      ref: { id: "spinning-axe", zoneEntryId: 1 },
      cardId: CARD_ID,
      name: "Spinning Axe",
      types: ["gear"],
      tags: ["Draven", "Equipment", "Signature"],
      keywords: [{ id: "Quick-Draw" }, { id: "Equip", value: 1 }, { id: "Temporary" }],
      owner: "A",
      controller: "A",
      zone: "board",
      location: { type: "base", player: "A" },
      might: 3,
      energy: 2,
      power: null,
      exhausted: false,
      damage: 0,
      stunned: false,
      buffs: 0,
      attachedTo: null,
      faceDown: false,
      isToken: false
    }
  );

  const quickDraw = registrations.find((registration) => registration.spec.filter.source !== undefined);
  assert.ok(quickDraw, "the Quick-Draw card-played trigger must be registered");
  assert.deepEqual(quickDraw.spec.filter, { event: "card-played", source: { canonicalCardId: CARD_ID } });
  assert.equal(quickDraw.optional, false);

  // The source discriminator must really gate the match on the card identity:
  // it matches when the event carries this card as its source and not when it
  // carries a different card.
  const axe = axeWorld().getObject("spinning-axe");
  const event = { timingPoint: "card-played", kind: "card-played", object: axe, source: axe, player: "A" };
  assert.equal(matchesTriggerEvent(quickDraw.spec.filter, event, "A"), true);
  assert.equal(
    matchesTriggerEvent({ ...quickDraw.spec.filter, source: { canonicalCardId: "other-card" } }, event, "A"),
    false
  );
});

test.todo(
  "sfd-186-221 Spinning Axe: [Temporary]'s merged expansion (CR 816.1.b/816.1.c) subscribes beginning-start, " +
    "which the closed EventPattern vocabulary (RIFT-39) still lacks, so pipeline.registerTrigger rejects the " +
    "spec; the effect.kill body itself executes (see the golden below)"
);

test.todo(
  "sfd-186-221 Spinning Axe: paying the printed Equip cost (one [A] Power, CR 135.2.e.5 / 818.1.c.2) is blocked on " +
    "the `equip` payment kind in cost/plan-values.ts and on a contract representation for Universal Power " +
    "(CR 163.2.b; in-progress RIFT-261); the merged cost plan rejects { kind: 'equip' } with reason judge-required"
);

test.todo(
  "sfd-186-221 Spinning Axe: the Quick-Draw play trigger can only fire end-to-end once the card-played event " +
    "carries this card's identity for EventPattern.source binding and a card-program → TriggerRegistration " +
    "adapter binds it (the RIFT-257 adapter is merged; chain/engine.ts still emits object/player only, so the " +
    "source filter from the merged Quick-Draw expansion never matches)"
);
