export type EngineeringDisplayMode = 'structure' | 'fbd' | 'split';

export const DISPLAY_MODES: { mode: EngineeringDisplayMode; label: string }[] = [
  { mode: 'structure', label: 'Structure View' },
  { mode: 'fbd', label: 'FBD View' },
  { mode: 'split', label: 'Split View' },
];

/** A view choice describes rendering only; it never edits either engineering state. */
export function displayModeLayout(mode: EngineeringDisplayMode) {
  return {
    showStructure: mode !== 'fbd',
    showFbd: mode !== 'structure',
    logAction: `${mode}_view` as const,
  };
}
