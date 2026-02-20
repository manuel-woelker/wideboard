import type { BoardNoteElement } from '../boardEngineTypes';
import type { BoardElementType } from '../elementRegistry';

const DEFAULT_NOTE_SIZE = {
  width: 260,
  height: 170
};

/**
 * Creates note-kind element behavior for registry registration.
 */
export function createNoteElementType(): BoardElementType<BoardNoteElement> {
  return {
    kind: 'note',
    createDefault(input) {
      return {
        id: input.id,
        kind: 'note',
        x: input.position?.x ?? 0,
        y: input.position?.y ?? 0,
        width: input.size?.width ?? DEFAULT_NOTE_SIZE.width,
        height: input.size?.height ?? DEFAULT_NOTE_SIZE.height,
        text: 'New note'
      };
    },
    reduce(model, event) {
      if (event.type === 'translate') {
        return {
          ...model,
          x: model.x + event.delta.x,
          y: model.y + event.delta.y
        };
      }

      return {
        ...model,
        ...event.frame
      };
    },
    getBounds(model) {
      return {
        x: model.x,
        y: model.y,
        width: model.width,
        height: model.height
      };
    }
  };
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe('createNoteElementType', () => {
    it('reduces note translate events', () => {
      const type = createNoteElementType();
      const next = type.reduce(
        {
          id: 'note-1',
          kind: 'note',
          x: 10,
          y: 20,
          width: 260,
          height: 170,
          text: 'A'
        },
        {
          type: 'translate',
          delta: { x: 5, y: -4 }
        }
      );

      expect(next.x).toBe(15);
      expect(next.y).toBe(16);
    });

    it('returns frame bounds from note geometry', () => {
      const type = createNoteElementType();
      const bounds = type.getBounds({
        id: 'note-1',
        kind: 'note',
        x: 2,
        y: 3,
        width: 4,
        height: 5,
        text: 'A'
      });

      expect(bounds).toEqual({
        x: 2,
        y: 3,
        width: 4,
        height: 5
      });
    });
  });
}
