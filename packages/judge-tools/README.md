# @riftbound/judge-tools

`@riftbound/judge-tools` is a dependency-free, pure-function boundary for
turning observed events and explicit rule checks into pending manual-judge
requests.

The package does not contain or reproduce official rules, rulings, or case
text. It stores only source metadata and operator-authored policy summaries.
External consumers must resolve the referenced sources themselves and comply
with their terms.

## Boundary

All package-defined objects reject unknown fields. The only open-ended JSON
region is `JudgeEvent.payload`.

`EvidenceRef` is intentionally limited to:

```ts
interface EvidenceRef {
  sourceType: "official-rule" | "official-case" | "policy-document";
  sourceId: string;
  url: string;
  version: string;
  ref: string;
}
```

`url` must be a public HTTPS URL without credentials, a port, query, or
fragment. `version` must be a numeric dotted source version. `ref` identifies a
relative section, rule, or case reference. There is no field for an excerpt,
quote, body, or copied case text.

A `JudgePolicyProfile` maps event types and rule-check outcomes to
`JudgeRequiredReason` entries through declarative escalation rules. All
evidence used by a profile reason must also be registered in
`profile.sources`.

## Synthetic Demo

The exported `createSyntheticDemoJudgePolicyProfile()` is an original,
executable example using the `synthetic-demo` ruleset. It is metadata only and
is not an official policy.

```ts
import {
  createJudgeReviewRequest,
  createSyntheticDemoJudgePolicyProfile
} from "@riftbound/judge-tools";

const profile = createSyntheticDemoJudgePolicyProfile();
const event = {
  id: "demo.event.1",
  type: "demo.zone-entered",
  sequence: 1,
  payload: { controller: "player.one", zone: "demo.arena" }
};
const checks = [
  {
    checkId: "demo.check.zone-owner",
    eventId: "demo.event.1",
    outcome: "indeterminate",
    evidence: [profile.sources[0]],
    note: "The original synthetic check could not choose an owner."
  }
];

const request = createJudgeReviewRequest(
  profile,
  event,
  checks,
  { requestedAt: "2026-10-11T00:00:00.000Z" }
);
```

`request` is `null` when no escalation rule matches. Otherwise it is a
`JudgeReviewRequest` with a content-derived `requestId`, `status: "pending"`,
the matched reasons, and the unique evidence union.

## API

The public surface includes:

- `validateEvidenceRef` and `parseEvidenceRef`
- `validateJudgePolicyProfile` and `parseJudgePolicyProfile`
- `validateJudgeEvent` and `parseJudgeEvent`
- `validateJudgeRuleCheck`, `validateJudgeRuleChecks`, and their parse forms
- `validateJudgeReviewRequest`, `parseJudgeReviewRequest`, and
  `createJudgeReviewRequest`
- `validateJudgeDecision` and `parseJudgeDecision`
- stable serializers and hashes for profiles, review requests, and decisions

Stable serializers recursively sort object keys and preserve array order.
Hashes use a pure JavaScript FNV-1a 64-bit implementation.

## Development

```sh
pnpm --filter @riftbound/judge-tools typecheck
pnpm --filter @riftbound/judge-tools build
pnpm --filter @riftbound/judge-tools test
```
