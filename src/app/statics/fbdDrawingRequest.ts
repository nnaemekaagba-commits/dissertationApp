const FBD_REFERENCE = /\b(fbd|free[ -]?body(?: diagram)?|rigid body diagram|fbd (?:sketch|screen ?shot)|(?:sketch|screen ?shot) of (?:an? )?(?:fbd|free[ -]?body diagram))\b/i;
const DRAWING_ACTION = /\b(build|create|draw|generate|make|construct|recreate|copy|trace|transfer|put|place|convert|turn)\b/i;
const ATTACHED_DRAWING_REFERENCE = /\b(this|it|that|attached|attachment|uploaded|pasted|image|picture|photo|sketch|screen ?shot)\b/i;
const CANVAS_REFERENCE = /\b(canvas|workspace|diagram|fbd|free[ -]?body)\b/i;
const ASKS_FOR_INSTRUCTIONS = /\bhow\s+(?:do|can|should|would)\s+i\b/i;
const IMAGE_OUTPUT = /\b(display|show|render|rendering)\b|\b(?:generate|create|make|produce)\b.{0,40}\b(?:an?\s+)?(?:image|picture|illustration|visual)\b/i;

export function explicitlyRequestsFBDImage(message: string, hasAttachment = false): boolean {
  if (ASKS_FOR_INSTRUCTIONS.test(message) || /\b(canvas|workspace)\b/i.test(message)) return false;
  return DRAWING_ACTION.test(message) && IMAGE_OUTPUT.test(message) &&
    (FBD_REFERENCE.test(message) || hasAttachment && /\b(this|it|attached|uploaded|pasted)\b/i.test(message));
}

export function explicitlyRequestsFBDDrawing(message: string, hasAttachment = false): boolean {
  if (explicitlyRequestsFBDImage(message, hasAttachment)) return false;
  if (ASKS_FOR_INSTRUCTIONS.test(message) || !DRAWING_ACTION.test(message)) return false;
  if (FBD_REFERENCE.test(message)) return true;
  return hasAttachment && ATTACHED_DRAWING_REFERENCE.test(message) && CANVAS_REFERENCE.test(message);
}

/** Give the model the exact cross-view contract for an explicitly requested diagram. */
export function buildFBDDrawingRequest(message: string, hasAttachment = false): string {
  if (!explicitlyRequestsFBDDrawing(message, hasAttachment)) return message;
  return `${message}

FBD DRAWING CONTRACT:
- The student explicitly requested diagram construction. Use only explicit fbd_* tools; do not merely describe a diagram.
- Read the complete problem description and every attached image before making tool calls.
- Return tool calls for the visible geometry rather than a generated image. When an uploaded sketch or screenshot is the source, recreate it on the interactive FBD canvas.
- Return exactly one JSON object shaped as {"response":"brief confirmation","toolCalls":[...]}. Each toolCalls item must be {"id":"unique-id","name":"fbd_add_*","arguments":{...}}. Do not return a prose-only explanation.
- Available creation calls are: fbd_add_body {x,y,width,height,angle?,label?,startJointKind?,endJointKind?}; fbd_add_joint {x,y,jointKind?,label?}; fbd_add_member {startX,startY,endX?,endY?,angle?,length?,label?,startJointKind?,endJointKind?}; fbd_add_force {x,y,angle,label,magnitude?,role?}; fbd_add_moment {x,y,clockwise,label,magnitude?,role?}; fbd_add_dimension {startX,startY,endX,endY,label}; fbd_add_angle {vertexX,vertexY,fromX,fromY,toX,toY,label}; fbd_add_label {x,y,text}.
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
