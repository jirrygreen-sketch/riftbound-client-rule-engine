import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/edge-of-night.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
const { runInstruction, world } = await import(new URL("effects/testing/index.js", ENGINE));
const attach = (await import(new URL("effects/instructions/effect.attach.js", ENGINE))).default;

const CANONICAL = "card.hash-8c103a7762e84199cb05a20d7107bd2ceb136e632e7df30beaaf4e7629b544da";
const SOURCE_TEXT =
  "[Hidden] (Hide now for :rb_rune_rainbow: to react with later for :rb_energy_0:.)\n" +
  "When you play this from face down, attach it to a unit you control here.\n" +
  "[Equip] :rb_rune_chaos: (:rb_rune_chaos:: Attach this to a unit you control.)";

const [hidden, triggered, equip] = program.abilities;
const [attachOnPlay] = triggered.body;

/** Edge of Night on a battlefield (its post-play home for the Hidden line). */
function edgeWorld() {
  const base = world()
    .object("edge-of-night", {
      name: "Edge of Night",
      cardId: CANONICAL,
      types: ["gear"],
      tags: ["Equipment"],
      zone: "board",
      location: { type: "battlefield", id: "battlefield-1" },
      energy: 3,
      power: null,
      might: 2
    })
    .unit("ally-here", { location: { type: "battlefield", id: "battlefield-1" } })
    .unit("ally-elsewhere", { location: { type: "battlefield", id: "battlefield-2" } })
    .build();
  return base.clone({ sourceSnapshot: base.getObject("edge-of-night") });
}

test("sfd-139-221 Edge of Night: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues));
  assert.deepEqual(result.issues, []);
});

test("sfd-139-221 Edge of Night: identity, ruleset, status, judgeReason and verbatim source text", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  // The judgeReason names the three real gaps and their dependencies.
  assert.match(program.judgeReason, /Hidden/);
  assert.match(program.judgeReason, /811\.1\.d/);
  assert.match(program.judgeReason, /RIFT-90/);
  assert.match(program.judgeReason, /RIFT-257/);
  assert.match(program.judgeReason, /RIFT-261/);
  assert.match(program.judgeReason, /equip/);
  assert.equal(program.sourceText, SOURCE_TEXT);
  assert.equal(cardRegistryById.get(CANONICAL), program);
});

test("sfd-139-221 Edge of Night: Hidden + play-triggered attach + valued Chaos Equip", () => {
  assert.equal(program.abilities.length, 3);

  // 811.1: Hidden is only declared; the expansion lives in effects/keywords/Hidden.ts.
  assert.deepEqual(hidden, { kind: "keyword", keyword: "hidden" });

  // 383.4.a.1: Gear Play Effect — the trigger points at this card's own play event.
  assert.equal(triggered.kind, "triggered");
  assert.equal(triggered.trigger.at, "card-played");
  assert.deepEqual(triggered.trigger.filter, {
    event: "card-played",
    filter: { source: "self" }
  });
  assert.equal(triggered.optional, false);
  assert.equal(triggered.body.length, 1);

  // "attach it to a unit you control here": the Gear itself is the attached
  // object (objects defaults to the source), one controlled unit at the same
  // location is the host (contract 3.6's sameLocationAs anchor carries "here").
  assert.equal(attachOnPlay.id, "edge-of-night.attach-on-play");
  assert.equal(attachOnPlay.op, "effect.attach");
  assert.equal(attachOnPlay.args.objects, undefined);
  assert.deepEqual(attachOnPlay.args.host, {
    kind: "constant",
    value: { kind: "target", id: "edge-of-night.controlled-unit-here" }
  });
  assert.deepEqual(attachOnPlay.targets, [{
    id: "edge-of-night.controlled-unit-here",
    filter: {
      type: "unit",
      controller: "self",
      zone: "board",
      sameLocationAs: "self"
    },
    min: 1,
    max: 1,
    selection: "one"
  }]);
  assert.equal(attachOnPlay.linkedTo, undefined);

  // 818.1.c: the printed rune is one Chaos Power.
  assert.equal(equip.kind, "keyword");
  assert.equal(equip.keyword, "equip");
  assert.equal(equip.value, 1);
  assert.equal(equip.costDomain, "Chaos");
});

test("sfd-139-221 Edge of Night golden: the printed attach instruction really attaches the Gear", () => {
  const kernel = edgeWorld();
  // The instruction is driven through the real primitive with a
  // Finalize-locked host (contract 3.6: ctx.targets carries what the target
  // system locked). Selecting that host is the production target pipeline's
  // job: the reference kernel's scalar query does not resolve the frozen
  // PlayerSelector spelling (controller: "self", 740.1.a) or the
  // sameLocationAs "here" scope, which is exactly the RIFT-90 gap recorded in
  // judgeReason. The printed args themselves are used unchanged.
  const run = runInstruction(
    attach,
    { host: attachOnPlay.args.host },
    { world: kernel, targets: { "edge-of-night.controlled-unit-here": [kernel.ref("ally-here")] } }
  );
  assert.equal(run.result.status, "executed");
  assert.deepEqual(kernel.getObject("edge-of-night").attachedTo, kernel.ref("ally-here"));
  assert.deepEqual(run.events.map((event) => event.action), ["attach"]);
  assert.deepEqual(run.linked.attached.host, kernel.ref("ally-here"));
  // 150.2: printed characteristics are untouched by the attach.
  assert.equal(kernel.getObject("edge-of-night").energy, 3);
  assert.equal(kernel.getObject("edge-of-night").might, 2);
});

test("sfd-139-221 Edge of Night golden: a stale host is ignored instead of being rebound by id", () => {
  const kernel = edgeWorld();
  const stale = kernel.ref("ally-here");
  // The unit changes zones: its zoneEntryId is invalidated (CR 124).
  assert.equal(kernel.perform({ type: "return-to-hand", object: stale }).status, "done");

  const run = runInstruction(
    attach,
    { host: attachOnPlay.args.host },
    { world: kernel, targets: { "edge-of-night.controlled-unit-here": [stale] } }
  );
  assert.deepEqual(run.result, { status: "ignored", reason: "mistargeted" });
  assert.equal(run.events.length, 0);
  assert.equal(kernel.getObject("edge-of-night").attachedTo, null);
});

test("sfd-139-221 Edge of Night: the merged Equip expansion is valid EffectIR for this card", () => {
  const definition = keywordDefinitionsById.get("Equip");
  assert.ok(definition, "effects/keywords/Equip.ts must be registered");
  const expansion = definition.expand({ value: equip.value, host: { canonicalCardId: CANONICAL } });
  const expanded = validateCardProgram({
    canonicalCardId: CANONICAL,
    rulesetVersion: "core-1.5",
    status: "executable",
    abilities: expansion,
    sourceText: SOURCE_TEXT
  });
  assert.deepEqual(expanded.issues, []);
  assert.deepEqual(expansion[0].body.map((step) => [step.id, step.op]), [["equip-attach", "effect.attach"]]);
});

test.todo(
  "sfd-139-221 Edge of Night: \"play this from face down\" needs the Hide action, the Facedown " +
    "Zone and the facedown-play permission (CR 811.1.b/811.1.c.3) plus a card-played " +
    "payload that says where the card was played from - no merged producer supplies it."
);
test.todo(
  "sfd-139-221 Edge of Night: the printed 811.1.d.1/811.1.d.3 restrictions (a hidden permanent " +
    "must be played to that battlefield, and play-effect targets must come from it) need the " +
    "Facedown Zone plus a runtime Location binding (RIFT-90); the sameLocationAs \"here\" anchor " +
    "has no consumer in the chain Finalize query (layers/filter.ts)."
);
test.todo(
  "sfd-139-221 Edge of Night: paying the printed Chaos Equip cost needs the \"equip\" payment " +
    "kind in cost/plan-values.ts (RIFT-261) plus the program -> keyword -> chain wiring " +
    "(contract 3.5, RIFT-257)."
);
test.todo(
  "sfd-139-221 Edge of Night: the play-triggered ability needs the card-program -> " +
    "TriggerRegistration producer (contract 3.5, RIFT-257) before it can fire."
);
