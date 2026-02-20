import type { BoardLinkElement } from '../boardEngineTypes';
import type { BoardElementType } from '../elementRegistry';

const DEFAULT_LINK_SIZE = {
  width: 340,
  height: 180
};

/**
 * Creates link-kind element behavior for registry registration.
 */
export function createLinkElementType(): BoardElementType<BoardLinkElement> {
  return {
    kind: 'link',
    createDefault(input) {
      return {
        id: input.id,
        kind: 'link',
        x: input.position?.x ?? 0,
        y: input.position?.y ?? 0,
        width: input.size?.width ?? DEFAULT_LINK_SIZE.width,
        height: input.size?.height ?? DEFAULT_LINK_SIZE.height,
        url: '',
        title: 'Link'
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

  describe('createLinkElementType', () => {
    it('reduces link translate events', () => {
      const type = createLinkElementType();
      const next = type.reduce(
        {
          id: 'link-1',
          kind: 'link',
          x: 40,
          y: 60,
          width: 340,
          height: 180,
          url: 'https://example.com',
          title: 'Example'
        },
        {
          type: 'translate',
          delta: { x: -8, y: 12 }
        }
      );

      expect(next.x).toBe(32);
      expect(next.y).toBe(72);
    });

    it('returns frame bounds from link geometry', () => {
      const type = createLinkElementType();
      const bounds = type.getBounds({
        id: 'link-1',
        kind: 'link',
        x: 7,
        y: 8,
        width: 9,
        height: 10,
        url: 'https://example.com',
        title: 'Example'
      });

      expect(bounds).toEqual({
        x: 7,
        y: 8,
        width: 9,
        height: 10
      });
    });
  });
}
