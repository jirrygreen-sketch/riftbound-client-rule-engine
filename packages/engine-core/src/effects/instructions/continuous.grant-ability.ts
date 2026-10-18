import type { InstructionDef, ResolveContext } from '../contract.js';
import { abilityArgsSchema, executeAbilityInstruction, type AbilityInstructionArgs } from '../../programs/ability-grants/instruction.js';

/** CR 479.3: retain the complete ability IR in the authoritative layer registry. */
const continuousGrantAbility = {
  op: 'continuous.grant-ability',
  argsSchema: abilityArgsSchema('continuous.grant-ability'),
  execute: (ctx: ResolveContext, args: AbilityInstructionArgs) => executeAbilityInstruction('continuous.grant-ability', ctx, args),
} satisfies InstructionDef<AbilityInstructionArgs>;
export default continuousGrantAbility;
