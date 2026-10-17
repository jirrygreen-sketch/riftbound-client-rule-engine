import assert from "node:assert/strict";
import test from "node:test";

import { EFFECT_IR_V2_RULESET, validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/sfd/purifier.js";

// card-dsl has no dependency edge on engine-core (engine-core depends on
// card-dsl), so golden execution loads the built engine through its workspace
// layout instead of the package name.
const ENGINE = new URL("../../../../engine-core/dist/", import.meta.url);
const { keywordDefinitionsById } = await import(new URL("effects/keywords/registry.generated.js", ENGINE));
// The production static binder is the path that turns the printed static
// ability into a live layer effect; the golden exercises it directly.
const { createProgramBinding } = await import(new URL("programs/index.js", ENGINE));
const { fixture } = await import(new URL("../../../../engine-core/test/chain/helpers.mjs", import.meta.url));

const CANONICAL_ID = "card.hash-d6988e3c4bfaf3cd84e8451ade514abc99df9e47acaa479d8e17bd78b14d1db5";
const SOURCE_TEXT =
  "Your Equipment each give [Assault]. (+1 :rb_might: while equipped unit is an attacker.)";

const [grant] = program.abilities;

test("sfd-183-221 Purifier: program passes validateCardProgram", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.deepEqual(result.issues, []);
});

test("sfd-183-221 Purifier: identity, ruleset, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL_ID);
  assert.equal(program.rulesetVersion, EFFECT_IR_V2_RULESET);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.equal(program.sourceText, SOURCE_TEXT);
  // cards/README.md section 2: the reason names the missing pieces, not a vague
  // "not implemented yet".
  assert.match(program.judgeReason, /programs\/statics/);
  assert.match(program.judgeReason, /807\.1\.c/);
  assert.match(program.judgeReason, /718\.3/);
  assert.match(program.judgeReason, /assault|Assault/);
});

test("sfd-183-221 Purifier: one static ability granting a keyword to your Equipment on the Board", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(grant.kind, "static");
  assert.equal(grant.effect.kind, "continuous.grant-keyword");
  // 807.1.b.3: no printed Assault value, so none is declared and the value
  // defaults to 1; the grant must not invent one.
  assert.equal(grant.effect.value, undefined);
  assert.deepEqual(grant.effect.filter, {
    zone: "board",
    controller: "controller",
    tags: ["Equipment"]
  });
  assert.equal(grant.condition, undefined);
});

test("sfd-183-221 Purifier: the granted keyword id is the merged Assault definition", () => {
  const definition = keywordDefinitionsById.get(grant.effect.keyword);
  assert.ok(definition, "the granted KeywordId must be registered");
  assert.equal(definition.keyword, "Assault");
  // 807: valued, and multiple Assaults on one unit sum (807.2).
  assert.equal(definition.valued, true);
  assert.equal(definition.stacking, "sum");
  assert.ok(definition.ruleRefs.includes("807.1.c"));
});

test("sfd-183-221 Purifier golden: the static binder grants [Assault] to your Equipment only", () => {
  // The program is still judge-required, so it is made executable in-memory only
  // for this binder probe; the shipped program and its judgeReason are untouched.
  const executable = { ...program, status: "executable" };
  delete executable.judgeReason;
  const binding = createProgramBinding({ cardPrograms: [executable] });
  const { engine, kernel } = fixture({
    cards: [
      { id: "purifier", cardId: CANONICAL_ID, types: ["legend"], energy: 0, power: [], might: null },
      { id: "blade", types: ["gear"], tags: ["Equipment"], energy: 1, power: [], might: null },
      { id: "enemy-blade", types: ["gear"], tags: ["Equipment"], energy: 1, power: [], might: null, owner: "B", controller: "B" },
      { id: "rig", types: ["gear"], energy: 2, power: [], might: null }
    ]
  });
  const board = (id) => engine.commit({ type: "move-zone", object: kernel.ref(id), to: "board" });
  board("blade");
  board("enemy-blade");
  board("rig");
  const lifecycle = binding.attachLifecycle(engine, () => {});
  board("purifier");
  engine.pipeline.emit({ timingPoint: "object-enters-board", object: kernel.getObject("purifier") });

  // The granted Assault prints no value (807.1.b.3), so the layer keeps none.
  assert.deepEqual(engine.layers.evaluate(kernel.ref("blade")).keywords.map((keyword) => keyword.id), ["Assault"]);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("enemy-blade")).keywords, []);
  assert.deepEqual(engine.layers.evaluate(kernel.ref("rig")).keywords, []);
  lifecycle.detach();
  assert.deepEqual(engine.layers.evaluate(kernel.ref("blade")).keywords, []);
});

test.todo(
  "sfd-183-221 Purifier: expansion of the granted Assault into its" +
    " \"while I am an attacker, +1 [M]\" arithmetic static effect (effects/keywords/Assault.ts" +
    " defines the expansion; nothing reads a granted keyword and applies it) — 807.1.c"
);

test.todo(
  "sfd-183-221 Purifier: 718.3 propagation of the granted Assault from the attached card to its" +
    " equipped unit, plus the production card-program lifecycle wiring into a live game"
);
