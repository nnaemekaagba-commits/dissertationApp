/** JSON data model for one engineering statics problem. No chat messages are stored here. */
export type LengthUnit = 'm' | 'cm' | 'mm' | 'ft' | 'in';
export type ForceUnit = 'N' | 'kN' | 'lbf' | 'kip';
export type MomentUnit = 'N*m' | 'kN*m' | 'lbf*ft' | 'kip*ft';
export type AngleUnit = 'deg' | 'rad';

export interface StaticsUnits {
  length: LengthUnit;
  force: ForceUnit;
  /** Optional for older saved problems; otherwise moment uses force × length. */
  moment?: MomentUnit;
  /** Optional; angles are in degrees when omitted. */
  angle?: AngleUnit;
}

export interface StaticsNode { id: string; x: number; y: number; label?: string }
export interface StaticsMember { id: string; startNodeId: string; endNodeId: string; label?: string }
export interface StaticsSupport {
  id: string;
  nodeId: string;
  kind: 'pin' | 'roller' | 'fixed';
  /** Roller reaction direction, measured counterclockwise from +x. */
  reactionAngle?: number;
}
export type StaticsLoad =
  | { id: string; kind: 'force'; nodeId: string; magnitude: number; angle: number }
  | { id: string; kind: 'moment'; nodeId: string; magnitude: number }
  | { id: string; kind: 'distributed'; memberId: string; startMagnitude: number; endMagnitude: number; angle: number };
export interface StaticsDimension {
  id: string;
  startNodeId: string;
  endNodeId: string;
  value: number;
  label?: string;
}
export interface StaticsAngle {
  id: string;
  vertexNodeId: string;
  fromNodeId: string;
  toNodeId: string;
  value: number;
  label?: string;
}
export interface StaticsWorkspace {
  nodes: StaticsNode[];
  members: StaticsMember[];
  supports: StaticsSupport[];
  loads: StaticsLoad[];
  dimensions: StaticsDimension[];
  units: StaticsUnits;
  /** Optional angle annotations; load directions also carry angles. */
  angles?: StaticsAngle[];
}

export const DEFAULT_STATICS_UNITS: StaticsUnits = {
  length: 'm', force: 'kN',
};

export function createStaticsWorkspace(): StaticsWorkspace {
  return {
    nodes: [], members: [], supports: [], loads: [], dimensions: [],
    units: { ...DEFAULT_STATICS_UNITS },
  };
}

/** Validates untrusted JSON and returns a detached, JSON-compatible value. */
export function parseStaticsWorkspace(input: unknown): StaticsWorkspace {
  const fail = (path: string): never => { throw new Error(`Invalid statics workspace: ${path}`); };
  const object = (value: unknown, path: string): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : fail(path);
  const id = (value: unknown, path: string): string =>
    typeof value === 'string' && value.trim().length > 0 ? value : fail(path);
  const number = (value: unknown, path: string): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fail(path);
  const label = (value: unknown, path: string): string | undefined =>
    value === undefined ? undefined : typeof value === 'string' ? value : fail(path);
  const choice = <T extends string>(value: unknown, values: readonly T[], path: string): T =>
    typeof value === 'string' && values.includes(value as T) ? value as T : fail(path);
  const items = <T>(value: unknown, path: string, read: (row: Record<string, unknown>, path: string) => T): T[] =>
    Array.isArray(value) ? value.map((entry, index) => read(object(entry, `${path}[${index}]`), `${path}[${index}]`)) : fail(path);
  const unique = (rows: { id: string }[], path: string) => {
    if (new Set(rows.map((row) => row.id)).size !== rows.length) fail(`${path} duplicate id`);
  };

  const root = object(input, 'root');
  // Read the previous stored format, but emit the requested top-level shape.
  if (root.schemaVersion !== undefined && root.schemaVersion !== 1) fail('schemaVersion');
  const units = object(root.units, 'units');
  const nodes = items(root.nodes, 'nodes', (row, path): StaticsNode => ({
    id: id(row.id, `${path}.id`), x: number(row.x, `${path}.x`), y: number(row.y, `${path}.y`),
    ...(row.label === undefined ? {} : { label: label(row.label, `${path}.label`) }),
  }));
  const members = items(root.members, 'members', (row, path): StaticsMember => ({
    id: id(row.id, `${path}.id`), startNodeId: id(row.startNodeId, `${path}.startNodeId`),
    endNodeId: id(row.endNodeId, `${path}.endNodeId`),
    ...(row.label === undefined ? {} : { label: label(row.label, `${path}.label`) }),
  }));
  const supports = items(root.supports, 'supports', (row, path): StaticsSupport => ({
    id: id(row.id, `${path}.id`), nodeId: id(row.nodeId, `${path}.nodeId`),
    kind: choice(row.kind, ['pin', 'roller', 'fixed'], `${path}.kind`),
    ...(row.reactionAngle === undefined ? {} : { reactionAngle: number(row.reactionAngle, `${path}.reactionAngle`) }),
  }));
  const loads = items(root.loads, 'loads', (row, path): StaticsLoad => {
    const commonId = id(row.id, `${path}.id`);
    const kind = choice(row.kind, ['force', 'moment', 'distributed'], `${path}.kind`);
    if (kind === 'force') return { id: commonId, kind, nodeId: id(row.nodeId, `${path}.nodeId`), magnitude: number(row.magnitude, `${path}.magnitude`), angle: number(row.angle, `${path}.angle`) };
    if (kind === 'moment') return { id: commonId, kind, nodeId: id(row.nodeId, `${path}.nodeId`), magnitude: number(row.magnitude, `${path}.magnitude`) };
    return { id: commonId, kind, memberId: id(row.memberId, `${path}.memberId`), startMagnitude: number(row.startMagnitude, `${path}.startMagnitude`), endMagnitude: number(row.endMagnitude, `${path}.endMagnitude`), angle: number(row.angle, `${path}.angle`) };
  });
  const dimensions = items(root.dimensions, 'dimensions', (row, path): StaticsDimension => ({
    id: id(row.id, `${path}.id`), startNodeId: id(row.startNodeId, `${path}.startNodeId`),
    endNodeId: id(row.endNodeId, `${path}.endNodeId`), value: number(row.value, `${path}.value`),
    ...(row.label === undefined ? {} : { label: label(row.label, `${path}.label`) }),
  }));
  const angles = items(root.angles ?? [], 'angles', (row, path): StaticsAngle => ({
    id: id(row.id, `${path}.id`), vertexNodeId: id(row.vertexNodeId, `${path}.vertexNodeId`),
    fromNodeId: id(row.fromNodeId, `${path}.fromNodeId`), toNodeId: id(row.toNodeId, `${path}.toNodeId`),
    value: number(row.value, `${path}.value`),
    ...(row.label === undefined ? {} : { label: label(row.label, `${path}.label`) }),
  }));
  for (const [name, rows] of Object.entries({ nodes, members, supports, loads, dimensions, angles })) unique(rows, name);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const memberIds = new Set(members.map((member) => member.id));
  const hasNode = (nodeId: string, path: string) => { if (!nodeIds.has(nodeId)) fail(path); };
  members.forEach((member, i) => {
    hasNode(member.startNodeId, `members[${i}].startNodeId`);
    hasNode(member.endNodeId, `members[${i}].endNodeId`);
    if (member.startNodeId === member.endNodeId) fail(`members[${i}] endpoints`);
  });
  supports.forEach((support, i) => {
    hasNode(support.nodeId, `supports[${i}].nodeId`);
    if (support.kind !== 'roller' && support.reactionAngle !== undefined) fail(`supports[${i}].reactionAngle`);
  });
  loads.forEach((load, i) => {
    if (load.kind === 'distributed') {
      if (!memberIds.has(load.memberId)) fail(`loads[${i}].memberId`);
    } else hasNode(load.nodeId, `loads[${i}].nodeId`);
  });
  dimensions.forEach((dimension, i) => {
    hasNode(dimension.startNodeId, `dimensions[${i}].startNodeId`);
    hasNode(dimension.endNodeId, `dimensions[${i}].endNodeId`);
    if (dimension.startNodeId === dimension.endNodeId || dimension.value <= 0) fail(`dimensions[${i}] value/endpoints`);
  });
  angles.forEach((angle, i) => {
    hasNode(angle.vertexNodeId, `angles[${i}].vertexNodeId`);
    hasNode(angle.fromNodeId, `angles[${i}].fromNodeId`);
    hasNode(angle.toNodeId, `angles[${i}].toNodeId`);
    if (new Set([angle.vertexNodeId, angle.fromNodeId, angle.toNodeId]).size !== 3) fail(`angles[${i}] nodes`);
  });
  return {
    nodes, members, supports, loads, dimensions,
    units: {
      length: choice(units.length, ['m', 'cm', 'mm', 'ft', 'in'], 'units.length'),
      force: choice(units.force, ['N', 'kN', 'lbf', 'kip'], 'units.force'),
      ...(units.moment === undefined ? {} : { moment: choice(units.moment, ['N*m', 'kN*m', 'lbf*ft', 'kip*ft'], 'units.moment') }),
      ...(units.angle === undefined ? {} : { angle: choice(units.angle, ['deg', 'rad'], 'units.angle') }),
    },
    ...(root.angles === undefined ? {} : { angles }),
  };
}
