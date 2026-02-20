import type { BoardElement, BoardElementFrame, BoardElementKind } from './boardEngineTypes';
import { createImageElementType } from './elementTypes/imageElementType';
import { createNoteElementType } from './elementTypes/noteElementType';

export interface BoardElementTypeCreateDefaultInput {
  id: string;
  position?: {
    x: number;
    y: number;
  };
  size?: {
    width: number;
    height: number;
  };
}

export type BoardElementTypeReduceEvent =
  | {
      type: 'translate';
      delta: {
        x: number;
        y: number;
      };
    }
  | {
      type: 'set_frame';
      frame: Partial<BoardElementFrame>;
    };

export interface BoardElementType<TModel extends BoardElement = BoardElement> {
  kind: TModel['kind'];
  createDefault(input: BoardElementTypeCreateDefaultInput): TModel;
  reduce(model: TModel, event: BoardElementTypeReduceEvent): TModel;
  getBounds(model: TModel): BoardElementFrame;
}

export class BoardElementRegistry {
  private readonly types = new Map<BoardElementKind, BoardElementType>();

  public constructor(types: BoardElementType[]) {
    types.forEach((type) => {
      if (this.types.has(type.kind)) {
        throw new Error(`Duplicate element type registration for kind "${type.kind}".`);
      }

      this.types.set(type.kind, type);
    });
  }

  public has(kind: string): kind is BoardElementKind {
    return this.types.has(kind as BoardElementKind);
  }

  public assertKnownKind(kind: string): void {
    if (!this.has(kind)) {
      throw new Error(`Unknown board element kind "${kind}".`);
    }
  }

  public createDefault(
    kind: BoardElementKind,
    input: BoardElementTypeCreateDefaultInput
  ): BoardElement {
    const type = this.get(kind);
    return type.createDefault(input);
  }

  public reduce(model: BoardElement, event: BoardElementTypeReduceEvent): BoardElement {
    const type = this.get(model.kind);
    return type.reduce(model as never, event) as BoardElement;
  }

  public getBounds(model: BoardElement): BoardElementFrame {
    const type = this.get(model.kind);
    return type.getBounds(model as never);
  }

  private get(kind: BoardElementKind): BoardElementType {
    const type = this.types.get(kind);
    if (!type) {
      throw new Error(`Unknown board element kind "${kind}".`);
    }

    return type;
  }
}

/* 📖 # Why provide a default registry factory?
Phase 3 keeps UI behavior stable while introducing pluggable element types.
Creating one canonical default registry ensures all engine entry points
validate and reduce note/image models consistently.
*/
export function createDefaultBoardElementRegistry() {
  return new BoardElementRegistry([createNoteElementType(), createImageElementType()]);
}

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  describe('BoardElementRegistry', () => {
    it('rejects duplicate kind registrations', () => {
      const noteType = createNoteElementType();
      expect(() => {
        return new BoardElementRegistry([noteType, noteType]);
      }).toThrow('Duplicate element type registration');
    });

    it('rejects unknown kinds at lookup time', () => {
      const registry = createDefaultBoardElementRegistry();
      expect(() => {
        registry.assertKnownKind('sticker');
      }).toThrow('Unknown board element kind "sticker"');
    });
  });
}
