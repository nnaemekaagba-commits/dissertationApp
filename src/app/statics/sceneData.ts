import type { StaticsWorkspace } from './model.ts';

/** The Three.js scene reads this projection of the one persisted workspace. */
export function selectSceneData(workspace: StaticsWorkspace) {
  return {
    nodes: workspace.nodes,
    members: workspace.members,
    supports: workspace.supports,
    loads: workspace.loads,
    dimensions: workspace.dimensions,
    angles: workspace.angles || [],
    units: workspace.units,
  };
}
