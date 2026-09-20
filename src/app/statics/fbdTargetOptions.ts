import type { StaticsWorkspace } from './model.ts';
import type { FBDTarget } from './fbdState.ts';

/** Always derive selectable objects from the current model. */
export function fbdTargetOptions(workspace: StaticsWorkspace, query = ''):
  { label: string; target: FBDTarget }[] {
  const options: { label: string; target: FBDTarget }[] = [
    { label: 'Body · Entire structure', target: { kind: 'body', id: 'structure' } },
    ...workspace.members.map((member) => ({ label: `Member · ${member.label || member.id}`,
      target: { kind: 'member' as const, id: member.id } })),
    ...workspace.nodes.map((node) => ({ label: `Joint · ${node.label || node.id}`,
      target: { kind: 'joint' as const, id: node.id } })),
  ];
  const needle = query.trim().toLocaleLowerCase();
  return needle ? options.filter((item) => `${item.label} ${item.target.id}`.toLocaleLowerCase().includes(needle)) : options;
}
