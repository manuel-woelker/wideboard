import { describe, expect, it } from 'vitest';
import { moveFrame, resizeFrame, type FrameRect, type ResizeHandlePosition } from './elementFrame';

describe('elementFrame', () => {
  const baseFrame: FrameRect = {
    x: 10,
    y: 20,
    width: 200,
    height: 120
  };

  it.each([
    [
      { x: 20, y: -5 },
      { x: 30, y: 15 }
    ],
    [
      { x: -10, y: 10 },
      { x: 0, y: 30 }
    ]
  ])('moves frame by pointer delta %j', (delta, expectedPosition) => {
    const moved = moveFrame(baseFrame, delta);
    expect({ x: moved.x, y: moved.y }).toEqual(expectedPosition);
  });

  it.each<
    [
      ResizeHandlePosition,
      { x: number; y: number },
      { x: number; y: number; width: number; height: number }
    ]
  >([
    ['bottom-right', { x: 20, y: 30 }, { x: 10, y: 20, width: 220, height: 150 }],
    ['right', { x: -500, y: 0 }, { x: 10, y: 20, width: 120, height: 120 }],
    ['left', { x: 40, y: 0 }, { x: 50, y: 20, width: 160, height: 120 }],
    ['top', { x: 0, y: 30 }, { x: 10, y: 50, width: 200, height: 90 }],
    ['top-left', { x: 25, y: 20 }, { x: 35, y: 40, width: 175, height: 100 }],
    ['bottom-left', { x: 30, y: 20 }, { x: 40, y: 20, width: 170, height: 140 }],
    ['top-right', { x: 20, y: 20 }, { x: 10, y: 40, width: 220, height: 100 }],
    ['bottom', { x: 0, y: -500 }, { x: 10, y: 20, width: 200, height: 80 }]
  ])('resizes frame from %s handle', (handle, delta, expectedFrame) => {
    const resized = resizeFrame(baseFrame, delta, handle, { width: 120, height: 80 });
    expect(resized).toEqual(expectedFrame);
  });
});
