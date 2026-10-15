import type { JsonValue } from "./types.js";
import {
  parseEvidenceRef,
  parseJudgeDecision,
  parseJudgePolicyProfile,
  parseJudgeReviewRequest,
  parseRuleFixtureSet
} from "./validation.js";
import { stableHash, stableStringify } from "./stable.js";

export function serializeEvidenceRef(input: unknown): string {
  return stableStringify(parseEvidenceRef(input) as unknown as JsonValue);
}

export function serializeJudgePolicyProfile(input: unknown): string {
  return stableStringify(parseJudgePolicyProfile(input) as unknown as JsonValue);
}

export function stableHashJudgePolicyProfile(input: unknown): string {
  return `fnv1a64:${stableHash(
    parseJudgePolicyProfile(input) as unknown as JsonValue
  )}`;
}

export function serializeJudgeReviewRequest(input: unknown): string {
  return stableStringify(parseJudgeReviewRequest(input) as unknown as JsonValue);
}

export function stableHashJudgeReviewRequest(input: unknown): string {
  return `fnv1a64:${stableHash(
    parseJudgeReviewRequest(input) as unknown as JsonValue
  )}`;
}

export function serializeJudgeDecision(input: unknown): string {
  return stableStringify(parseJudgeDecision(input) as unknown as JsonValue);
}

export function stableHashJudgeDecision(input: unknown): string {
  return `fnv1a64:${stableHash(
    parseJudgeDecision(input) as unknown as JsonValue
  )}`;
}

export function serializeRuleFixtureSet(input: unknown): string {
  return stableStringify(parseRuleFixtureSet(input) as unknown as JsonValue);
}

export function stableHashRuleFixtureSet(input: unknown): string {
  return `fnv1a64:${stableHash(
    parseRuleFixtureSet(input) as unknown as JsonValue
  )}`;
}
