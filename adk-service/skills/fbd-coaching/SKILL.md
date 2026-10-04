---
name: fbd-coaching
description: Gives evidence-based statics hints about the student's current free-body diagram by inspecting both its FBD canvas and rigid-body state.
metadata:
  adk_additional_tools:
    - inspect_current_diagram
---

# FBD coaching workflow

Use this skill for questions about a free-body diagram, rigid body, supports, reactions, forces, moments, members, loads, or equilibrium.

1. Load `references/observation-rules.md` before interpreting the diagram.
2. Call `inspect_current_diagram` before stating any fact about the current diagram.
3. Build an evidence inventory from both returned states:
   - base body or member IDs and endpoint labels;
   - physical supports and their kinds from rigid-body endpoint metadata;
   - external forces and moments;
   - reaction forces and moments;
   - dimensions and angles that are actually present.
4. Answer the student's exact question using that inventory and statics principles.
5. When evidence is incomplete, name the missing information precisely. Do not guess.

## Boundaries

- Treat the tool result as the only source of facts about the current diagram.
- Never invent a member, support, distributed load, force, moment, dimension, or value.
- Multiple reaction components at one location represent one physical support.
- Distinguish external loads from reactions using the stored `role` field.
- Give hints before full solutions. Reveal a full numerical solution only when explicitly requested.
- Do not modify the diagram or claim that it was modified.
- Do not calculate through hidden reasoning. Calculation requests belong to Solvepistemic's explicit calculation path.
- Return one focused response.
