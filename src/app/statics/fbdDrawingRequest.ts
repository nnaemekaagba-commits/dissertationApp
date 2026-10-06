const FBD_REFERENCE = /\b(fbd|free[ -]?body(?: diagram)?|rigid body diagram)\b/i;
const DRAWING_ACTION = /\b(build|create|draw|generate|make|construct)\b/i;

export function explicitlyRequestsFBDDrawing(message: string): boolean {
  return FBD_REFERENCE.test(message) && DRAWING_ACTION.test(message);
}

/** Give the model the exact cross-view contract for an explicitly requested diagram. */
export function buildFBDDrawingRequest(message: string): string {
  if (!explicitlyRequestsFBDDrawing(message)) return message;
  return `${message}

FBD DRAWING CONTRACT:
- The student explicitly requested diagram construction. Use only explicit fbd_* tools; do not merely describe a diagram.
- Read the complete problem description and every attached image before making tool calls.
- Draw the isolated member or body first, then all visible applied forces, reaction forces, applied or reaction moments, dimensions, angles, and labels.
- Preserve the problem's endpoint labels. For example, member AD must be labelled AD so its endpoints display A and D.
- On fbd_add_body or fbd_add_member, set startJointKind and endJointKind to pin, roller, fixed, or free when the problem identifies supports. These support fields create the Rigid Body View.
- On every force and moment, set role to applied or reaction. Applied loads appear in both the FBD and Rigid Body views; reactions determine support representation.
- Use one physical support per location. A pin may have two reaction components, a roller one normal reaction, and a fixed support may have reaction forces and a reaction moment.
- Do not calculate unknown reaction magnitudes unless the student explicitly asks for calculation. Unknown reactions may be drawn and labelled without a magnitude.
- Do not invent information hidden or absent from the description or image. If essential geometry or support information is unreadable, ask one precise question instead of drawing a guessed diagram.`;
}

export function isFBDDiagramPrompt(message: string): boolean {
  return FBD_REFERENCE.test(message);
}
