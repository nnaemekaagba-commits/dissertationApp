# Diagram observation rules

## Evidence priority

1. Use `fbdState.members`, `bodies`, `forces`, `moments`, `dimensions`, `angles`, and `labels` for what the student drew.
2. Use `engineeringState` and endpoint support metadata for the corresponding rigid body and physical supports.
3. A force or moment with `role: applied` is external. A force or moment with `role: reaction` is a support reaction.
4. Absence from the returned arrays means the item is not currently shown. Never infer a distributed load from several point forces.

## Support interpretation

- Pin: two independent planar reaction components at one physical point.
- Roller: one reaction normal to the supporting surface.
- Fixed: force components and a reaction moment in planar statics.
- Count support locations, not reaction arrows. Two reaction arrows at the same pin are one support.

## Response format

State what you observed first, citing the actual IDs and locations. Then give the relevant statics hint. If the requested conclusion cannot be supported, state exactly which datum is missing.
