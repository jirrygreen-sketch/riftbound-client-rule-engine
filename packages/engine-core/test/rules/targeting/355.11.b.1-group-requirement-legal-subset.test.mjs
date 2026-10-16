// Scenario: targeting-group-requirement-legal-subset (CR v1.5 355.11.b, 355.11.b.1)
//
// Fox-Fire ("Kill any number of units at a battlefield with total Might 4 or
// less"): when +1/+1 reactions push the locked group's total Might over the
// limit, the controller must kill a legal subset of the original targets and
// that subset must include the maximum number of legal targets possible.
import test from 'node:test';

// Two merged pieces are needed and neither is present:
// 1. An aggregate targeting requirement (total Might of the selected group,
//    CR 355.11.b): TargetRequirement only carries a boolean group marker;
//    nothing evaluates the collective constraint at Finalize or Resolve.
// 2. The maximum-legal-subset rule of 355.11.b.1, which needs that same
//    evaluator to rank candidate subsets.
// Both obligation halves are bound to the missing evaluator, so the scenario
// stays a todo instead of asserting a hand-computed subset.
test.todo('targeting-group-requirement-legal-subset: blocked on the group requirement evaluator (355.11.b / 355.11.b.1) — no merged aggregate scoring of a TargetRequirement group and no maximum-legal-subset selection');
