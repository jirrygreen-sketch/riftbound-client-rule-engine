import { FOUNDATION_RULESET_ID } from "@riftbound/protocol";

export const HOT_FEPR_STEPS = [
  "handle-outstanding-tasks",
  "finalize",
  "execute",
  "pass",
  "resolve",
  "cleanup"
] as const;

export type HotFeprStep = (typeof HOT_FEPR_STEPS)[number];

export const RULESET_ID = FOUNDATION_RULESET_ID;
export const SYNTHETIC_RULESET_ID = "synthetic-demo";
