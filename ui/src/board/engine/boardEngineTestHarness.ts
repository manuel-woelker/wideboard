import { BoardEngine, type BoardEngineUpdate } from './BoardEngine';
import type { BoardDelta } from './boardDeltas';
import type { BoardEngineConfig, BoardState } from './boardEngineTypes';

/**
 * One normalized state diff entry used by harness snapshot assertions.
 */
export interface BoardEngineStateDiffEntry {
  /** Diff category for this path. */
  kind: 'added' | 'removed' | 'changed';
  /** JSON-style path to the changed value. */
  path: string;
  /** Previous value when relevant. */
  before?: unknown;
  /** Current value when relevant. */
  after?: unknown;
}

/**
 * Snapshot payload for engine update envelopes emitted during the act phase.
 */
export interface BoardEngineEventSnapshot {
  /** Revision number for this update. */
  revision: number;
  /** Deltas emitted by this revision. */
  deltas: BoardDelta[];
}

/**
 * Snapshot pair asserted in the harness assert phase.
 */
export interface BoardEngineHarnessExpectedSnapshots {
  /** Expected emitted updates for the act phase. */
  events: BoardEngineEventSnapshot[];
  /** Expected state diff between arrange baseline and act result. */
  stateDiff: BoardEngineStateDiffEntry[];
}

/**
 * Required phases for one harness test execution.
 */
export interface BoardEngineHarnessTestDefinition {
  /** Arrange phase: prepare state and define the assert baseline. */
  arrange: (engine: BoardEngine) => void;
  /** Act phase: run behavior under test. */
  act: (engine: BoardEngine) => void;
  /** Assert phase expected snapshots. */
  assert: BoardEngineHarnessExpectedSnapshots;
}

/**
 * Actual snapshots produced by the assert phase.
 */
export interface BoardEngineHarnessActualSnapshots {
  /** Captured emitted updates for the act phase. */
  events: BoardEngineEventSnapshot[];
  /** Computed state diff from arrange baseline to current state. */
  stateDiff: BoardEngineStateDiffEntry[];
}

function toPlainSnapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnKey(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function buildStateDiffEntries(
  path: string,
  previous: unknown,
  current: unknown,
  output: BoardEngineStateDiffEntry[]
) {
  if (Object.is(previous, current)) {
    return;
  }

  if (Array.isArray(previous) && Array.isArray(current)) {
    const maxLength = Math.max(previous.length, current.length);
    for (let index = 0; index < maxLength; index += 1) {
      const nextPath = `${path}[${index}]`;
      const hasPrevious = index < previous.length;
      const hasCurrent = index < current.length;
      if (hasPrevious && hasCurrent) {
        buildStateDiffEntries(nextPath, previous[index], current[index], output);
        continue;
      }

      if (hasCurrent) {
        output.push({
          kind: 'added',
          path: nextPath,
          after: toPlainSnapshot(current[index])
        });
        continue;
      }

      output.push({
        kind: 'removed',
        path: nextPath,
        before: toPlainSnapshot(previous[index])
      });
    }
    return;
  }

  if (isObject(previous) && isObject(current)) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
    [...keys].sort().forEach((key) => {
      const nextPath = `${path}.${key}`;
      const previousHasKey = hasOwnKey(previous, key);
      const currentHasKey = hasOwnKey(current, key);
      if (previousHasKey && currentHasKey) {
        buildStateDiffEntries(nextPath, previous[key], current[key], output);
        return;
      }

      if (currentHasKey) {
        output.push({
          kind: 'added',
          path: nextPath,
          after: toPlainSnapshot(current[key])
        });
        return;
      }

      output.push({
        kind: 'removed',
        path: nextPath,
        before: toPlainSnapshot(previous[key])
      });
    });
    return;
  }

  output.push({
    kind: 'changed',
    path,
    before: toPlainSnapshot(previous),
    after: toPlainSnapshot(current)
  });
}

function createBoardStateDiffSnapshot(
  previous: BoardState,
  current: BoardState
): BoardEngineStateDiffEntry[] {
  const diffEntries: BoardEngineStateDiffEntry[] = [];
  buildStateDiffEntries('$', previous, current, diffEntries);
  return diffEntries;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function assertSnapshotEquals(label: string, actual: unknown, expected: unknown) {
  const actualSerialized = stableSerialize(actual);
  const expectedSerialized = stableSerialize(expected);
  if (actualSerialized === expectedSerialized) {
    return;
  }

  throw new Error(
    [
      `${label} snapshot mismatch.`,
      'Expected:',
      JSON.stringify(expected, null, 2),
      'Actual:',
      JSON.stringify(actual, null, 2)
    ].join('\n')
  );
}

/**
 * Test harness for board engine scenarios using Arrange -> Act -> Assert phases.
 */
export class BoardEngineTestHarness {
  private readonly engine: BoardEngine;
  private arrangeBaselineState: BoardState;
  private readonly allUpdates: BoardEngineUpdate[] = [];
  private actPhaseUpdateStart = 0;

  public constructor(config: BoardEngineConfig = {}) {
    this.engine = new BoardEngine(config);
    this.arrangeBaselineState = toPlainSnapshot(this.engine.getState());

    this.engine.subscribe((update) => {
      this.allUpdates.push(toPlainSnapshot(update));
    });
  }

  /**
   * Runs a full Arrange -> Act -> Assert cycle with required phase fields.
   */
  public test(definition: BoardEngineHarnessTestDefinition): BoardEngineHarnessActualSnapshots {
    definition.arrange(this.engine);
    this.arrangeBaselineState = toPlainSnapshot(this.engine.getState());
    this.actPhaseUpdateStart = this.allUpdates.length;
    definition.act(this.engine);
    const actual = this.captureSnapshots();
    assertSnapshotEquals('events', actual.events, definition.assert.events);
    assertSnapshotEquals('stateDiff', actual.stateDiff, definition.assert.stateDiff);
    return actual;
  }

  /**
   * Captures current actual snapshots without asserting.
   */
  public captureSnapshots(): BoardEngineHarnessActualSnapshots {
    const actUpdates = this.allUpdates.slice(this.actPhaseUpdateStart);
    return {
      events: actUpdates.map((update) => ({
        revision: update.revision,
        deltas: toPlainSnapshot(update.deltas)
      })),
      stateDiff: createBoardStateDiffSnapshot(
        this.arrangeBaselineState,
        toPlainSnapshot(this.engine.getState())
      )
    };
  }
}

/**
 * Creates a new arrange/act/assert test harness for the board engine.
 */
export function createBoardEngineTestHarness(config: BoardEngineConfig = {}) {
  return new BoardEngineTestHarness(config);
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const initialElements = [
    {
      id: 'note-1',
      kind: 'note' as const,
      x: 10,
      y: 20,
      width: 100,
      height: 80,
      text: 'Hello'
    },
    {
      id: 'image-1',
      kind: 'image' as const,
      x: 220,
      y: 120,
      width: 200,
      height: 160,
      src: '/img.png',
      alt: 'img'
    }
  ];

  describe('BoardEngineTestHarness', () => {
    it('requires arrange, act and assert phases through a single test definition', () => {
      const harness = createBoardEngineTestHarness({
        initialElements
      });

      const actual = harness.test({
        arrange: (engine) => {
          engine.dispatch({
            type: 'select',
            ids: ['note-1']
          });
        },
        act: (engine) => {
          engine.dispatch({
            type: 'move_selection',
            delta: { x: 5, y: -2 }
          });
        },
        assert: {
          events: [
            {
              revision: 2,
              deltas: [
                {
                  type: 'element_updated',
                  id: 'note-1',
                  previous: {
                    id: 'note-1',
                    kind: 'note',
                    x: 10,
                    y: 20,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  },
                  current: {
                    id: 'note-1',
                    kind: 'note',
                    x: 15,
                    y: 18,
                    width: 100,
                    height: 80,
                    text: 'Hello'
                  }
                }
              ]
            }
          ],
          stateDiff: [
            {
              kind: 'changed',
              path: '$.elements.note-1.x',
              before: 10,
              after: 15
            },
            {
              kind: 'changed',
              path: '$.elements.note-1.y',
              before: 20,
              after: 18
            }
          ]
        }
      });

      expect(actual.events).toHaveLength(1);
      expect(actual.stateDiff).toHaveLength(2);
    });
  });
}
