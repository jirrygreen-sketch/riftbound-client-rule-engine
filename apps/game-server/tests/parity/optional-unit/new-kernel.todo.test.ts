import { describe, test } from "vitest";
import { migrationScenarios, optionalUnits } from "./scenarios.js";

// Both genuine CardPrograms remain judge-required. Never substitute a synthetic
// executable program or supply optionalAdditional/entry effects from this test.
// See docs/plans/parity/optional-unit.md for source evidence and deletion gates.
describe("optional Unit retirement gate: new game + programs + genuine CardProgram", () => {
  for (const unit of optionalUnits) {
    for (const scenario of migrationScenarios) {
      test.todo(`${scenario.id} ${unit.printingId} ${unit.name}: ${scenario.behavior}; BLOCKED: ${scenario.gap}`);
    }
  }
});
