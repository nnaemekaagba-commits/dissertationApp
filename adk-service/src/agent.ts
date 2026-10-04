import { FunctionTool, InMemoryRunner, LlmAgent, isFinalResponse } from '@google/adk';
import { z } from 'zod';
import type { DiagramSnapshot } from './contract.js';

const INSTRUCTION = `You are Solvepistemic's read-only statics and free-body-diagram coach.

For every statics or FBD answer, first call inspect_current_diagram. It contains both the student's current FBD canvas and the rigid-body EngineeringState. Treat that tool result as the only source of facts about the current diagram.

Rules:
- Refer to actual element IDs, endpoint labels, support kinds, force locations, directions, roles, moments, and dimensions from the tool result.
- Count physical supports from the rigid-body support metadata. Multiple reaction components at one point are one support.
- Never invent a member, support, distributed load, force, moment, dimension, or numerical value.
- Distinguish external applied loads from support reactions using their stored role.
- Give targeted hints and statics reasoning. Do not silently correct or claim to change the diagram.
- You have no modification tool and no calculation tool. If the student requests either, state that the explicit application tool must handle it.
- Do not reveal a full numerical solution unless the student explicitly asks.
- Produce one response only.`;

export async function runFBDCoach(snapshot: DiagramSnapshot, prompt: string): Promise<string> {
  const inspect = new FunctionTool({
    name: 'inspect_current_diagram',
    description: 'Returns the exact current rigid-body EngineeringState and active student FBDState. Read-only.',
    parameters: z.object({}),
    execute: async () => ({ status: 'success', ...snapshot }),
  });
  const agent = new LlmAgent({ name: 'solvepistemic_fbd_coach', model: process.env.ADK_MODEL || 'gemini-2.5-flash',
    description: 'Grounded read-only coaching for a student-built statics FBD.', instruction: INSTRUCTION,
    tools: [inspect] });
  const runner = new InMemoryRunner({ agent, appName: 'solvepistemic' });
  const userId = 'student';
  const session = await runner.sessionService.createSession({ appName: 'solvepistemic', userId });
  let answer = '';
  for await (const event of runner.runAsync({ userId, sessionId: session.id,
    newMessage: { role: 'user', parts: [{ text: prompt }] } })) {
    if (isFinalResponse(event)) answer = (event.content?.parts || [])
      .map((part) => 'text' in part ? part.text || '' : '').join('\n').trim();
  }
  if (!answer) throw new Error('ADK returned no final response.');
  return answer;
}
