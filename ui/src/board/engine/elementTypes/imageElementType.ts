import type { BoardImageElement } from '../boardEngineTypes';
import type { BoardElementType } from '../elementRegistry';

const DEFAULT_IMAGE_SIZE = {
  width: 320,
  height: 240
};

/**
 * Creates image-kind element behavior for registry registration.
 */
export function createImageElementType(): BoardElementType<BoardImageElement> {
  return {
    kind: 'image',
    createDefault(input) {
      return {
        id: input.id,
        kind: 'image',
        x: input.position?.x ?? 0,
        y: input.position?.y ?? 0,
        width: input.size?.width ?? DEFAULT_IMAGE_SIZE.width,
        height: input.size?.height ?? DEFAULT_IMAGE_SIZE.height,
        src: '',
        alt: 'Image'
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

  describe('createImageElementType', () => {
    it('reduces image translate events', () => {
      const type = createImageElementType();
      const next = type.reduce(
        {
          id: 'image-1',
          kind: 'image',
          x: 40,
          y: 60,
          width: 320,
          height: 240,
          src: '/img.png',
          alt: 'img'
        },
        {
          type: 'translate',
          delta: { x: -8, y: 12 }
        }
      );

      expect(next.x).toBe(32);
      expect(next.y).toBe(72);
    });

    it('returns frame bounds from image geometry', () => {
      const type = createImageElementType();
      const bounds = type.getBounds({
        id: 'image-1',
        kind: 'image',
        x: 7,
        y: 8,
        width: 9,
        height: 10,
        src: '/img.png',
        alt: 'img'
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
