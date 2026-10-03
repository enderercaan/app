import type { Purpose, Species } from '../types/domain';

export const CORE_PURPOSES: readonly Purpose[] = ['socialize','playmate','walk'];

// Mating is never a marketplace feature. It is exposed only when the server's
// jurisdiction policy explicitly says an owner-arranged mating interest is allowed.
export function enabledPurposes(matingOwnerArrangedEnabled:boolean,species:Species='dog'):readonly Purpose[]{
  return matingOwnerArrangedEnabled&&species==='dog'?[...CORE_PURPOSES,'mating']:CORE_PURPOSES;
}

export function visiblePurposes(purposes:Purpose[],matingOwnerArrangedEnabled=false,species:Species='dog'){
  const allowed=new Set(enabledPurposes(matingOwnerArrangedEnabled,species));
  return purposes.filter((purpose)=>allowed.has(purpose));
}
