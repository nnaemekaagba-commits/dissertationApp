import assert from 'node:assert/strict';
import test from 'node:test';
import { FBD_DEVELOPMENT_CASES } from './fbdDevelopmentFixtures.ts';
import { parseStaticsWorkspace } from './model.ts';
import { parseFBDState } from './fbdState.ts';
import { checkStudentFBD } from './checkFBD.ts';

test('development set covers seven distinct FBD scenarios with valid JSON models', () => {
  assert.deepEqual(FBD_DEVELOPMENT_CASES.map((item) => item.id), [
    'simply-supported-beam', 'cantilever-beam', 'inclined-force', 'applied-couple',
    'pin-jointed-truss-joint', 'member-isolation', 'multiple-applied-loads',
  ]);
  for (const fixture of FBD_DEVELOPMENT_CASES) {
    assert.deepEqual(parseStaticsWorkspace(JSON.parse(JSON.stringify(fixture.engineeringState))), fixture.engineeringState);
    assert.deepEqual(parseFBDState(JSON.parse(JSON.stringify(fixture.expected)), fixture.engineeringState), fixture.expected);
    assert.ok(fixture.commonIncorrect.length > 0, fixture.id);
    for (const example of fixture.commonIncorrect)
      assert.deepEqual(parseFBDState(JSON.parse(JSON.stringify(example.state)), fixture.engineeringState), example.state);
  }
});

for (const fixture of FBD_DEVELOPMENT_CASES) {
  test(`${fixture.id}: expected diagram and common mistakes`, () => {
    const problemBefore = JSON.stringify(fixture.engineeringState);
    const expectedBefore = JSON.stringify(fixture.expected);
    const valid = checkStudentFBD(fixture.engineeringState, fixture.expected);
    if (fixture.checkerLimit) {
      assert.ok(valid.limitations.some((item) => item.includes(fixture.checkerLimit)));
      // The checker has no representation for member-end interactions yet.
      assert.ok(valid.issues.every((issue) => issue.kind === 'extra_force' &&
        ['FAC', 'FBC'].includes(issue.elementId)));
    } else {
      assert.equal(valid.status, 'no_discrepancies', fixture.id);
      assert.deepEqual(valid.issues, []);
    }
    for (const example of fixture.commonIncorrect) {
      const result = checkStudentFBD(fixture.engineeringState, example.state);
      for (const kind of example.expectedIssues)
        assert.ok(result.issues.some((issue) => issue.kind === kind),
          `${fixture.id}: ${example.description} should yield ${kind}`);
    }
    assert.equal(JSON.stringify(fixture.engineeringState), problemBefore);
    assert.equal(JSON.stringify(fixture.expected), expectedBefore);
  });
}
