import assert from "node:assert/strict";
import test from "node:test";

import { validateCardProgram } from "../../../dist/index.js";
import program from "../../../dist/cards/ogn/karthus-eternal.js";
import { cardRegistryById } from "../../../dist/cards/registry.generated.js";
import deathknell from "../../../../engine-core/dist/effects/keywords/Deathknell.js";
import { keywordDefinitionsById } from "../../../../engine-core/dist/effects/keywords/registry.generated.js";

const CANONICAL = "card.hash-f3293211dd6f878acb245cc2cf0f2d2f2b066eed84ddbc009999e2176265a0ae";
const [ability] = program.abilities;

test("ogn-236-298 Karthus, Eternal: program passes validateCardProgram and is registered", () => {
  const result = validateCardProgram(program);
  assert.equal(result.ok, true, JSON.stringify(result.ok ? [] : result.issues, null, 2));
  assert.equal(cardRegistryById.get(program.canonicalCardId), program);
});

test("ogn-236-298 Karthus, Eternal: identity, status and verbatim sourceText", () => {
  assert.equal(program.canonicalCardId, CANONICAL);
  assert.equal(program.rulesetVersion, "core-1.5");
  assert.equal(program.status, "judge-required");
  assert.match(program.judgeReason, /808\.1/);
  assert.match(program.judgeReason, /continuous\.trigger-multiplicity/);
  assert.match(program.judgeReason, /EventPipeline\.scan/);
  assert.match(program.judgeReason, /效果正文/);
  assert.equal(program.sourceText, "Your [Deathknell] effects trigger an additional time.");
});

test("ogn-236-298 Karthus, Eternal: one static trigger-multiplicity effect scoped to friendly Deathknells", () => {
  assert.equal(program.abilities.length, 1);
  assert.equal(ability.kind, "static");
  assert.equal(ability.effect.kind, "continuous.trigger-multiplicity");
  assert.equal(ability.effect.mode, "additional");
  assert.deepEqual(ability.effect.amount, { kind: "constant", value: 1 });
  assert.deepEqual(ability.effect.appliesTo, {
    keyword: "deathknell",
    controller: "controller",
    zone: "board"
  });
  assert.equal(ability.condition, undefined);
});

test("ogn-236-298 Karthus, Eternal: Deathknell declares independent self-death triggers (808.1/808.2)", () => {
  assert.equal(keywordDefinitionsById.get("Deathknell"), deathknell);
  assert.equal(deathknell.stacking, "separate");
  const [expanded] = deathknell.expand({ host: { canonicalCardId: CANONICAL } });
  assert.equal(expanded.kind, "triggered");
  assert.equal(expanded.trigger.at, "object-killed");
  assert.deepEqual(expanded.trigger.filter, { self: true, cause: "kill", destination: "trash" });
  assert.equal(expanded.optional, false);
});

test.todo(
  "Karthus: collect an additional friendly Deathknell trigger, with separate chain item/targets, " +
    "using continuous.trigger-multiplicity and a bound Deathknell effect body (CR 808.1/808.2, 383.4.g.2)"
);
