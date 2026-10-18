import type { Ability } from "@riftbound/card-dsl";
import type { KeywordDef } from "../keyword-contract.js";
import { ProgramBindingError } from "../../programs/errors.js";

/**
 * Predict — Core Rules v1.5 §437.
 *
 * Predict is a limited action used by card text, rather than a permanent
 * characteristic. Keeping the expansion in the keyword registry gives card
 * compilers one canonical implementation while preserving the normal
 * inspect → recycle → order transaction and its ordered zone-slice input.
 */

function expand(): readonly Ability[] {
  // §437 describes an instruction that is embedded in another ability. The
  // frozen KeywordDef return type can only produce a complete Ability and has
  // no Limited-Action/body fragment slot, so returning an invented activated
  // cost would silently change the rules. Keep this registered but fail
  // closed until the additive body-fragment contract exists.
  throw new ProgramBindingError(
    "judge-required",
    "Predict is a body action and requires the additive keyword body-fragment contract"
  );
}

const predict = {
  keyword: "Predict",
  valued: true,
  stacking: "separate",
  expand,
  ruleRefs: ["437", "437.1", "437.1.a", "437.2", "437.3", "437.3.a", "437.4", "437.4.a"]
} satisfies KeywordDef;

export default predict;
