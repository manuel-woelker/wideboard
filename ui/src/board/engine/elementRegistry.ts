import type { BoardElement, BoardElementFrame, BoardElementKind } from './boardEngineTypes';
import { createImageElementType } from './elementTypes/imageElementType';
import { createNoteElementType } from './elementTypes/noteElementType';

/**
 * Input for kind-specific default element creation.
 */
export interface BoardElementTypeCreateDefaultInput {
  /** Requested id for the new element. */
  id: string;
  /** Optional starting position. */
  position?: {
    /** Initial X position. */
    x: number;
    /** Initial Y position. */
    y: number;
  };
  /** Optional starting dimensions. */
  size?: {
    /** Initial width. */
    width: number;
    /** Initial height. */
    height: number;
  };
}

export type BoardElementTypeReduceEvent =
  | {
      /** Translate event type. */
      type: 'translate';
      /** Translation delta in board space. */
      delta: {
        /** Delta X. */
        x: number;
        /** Delta Y. */
        y: number;
      };
    }
  | {
      /** Absolute/partial frame override event type. */
      type: 'set_frame';
      /** Partial frame values to apply. */
      frame: Partial<BoardElementFrame>;
    };

/**
 * Kind-specific behavior contract used by the board engine.
 */
export interface BoardElementType<TModel extends BoardElement = BoardElement> {
  /** Element kind handled by this type. */
  kind: TModel['kind'];
  /** Creates a default model instance for this kind. */
  createDefault(input: BoardElementTypeCreateDefaultInput): TModel;
  /** Applies a kind-scoped reducer event to the model. */
  reduce(model: TModel, event: BoardElementTypeReduceEvent): TModel;
  /** Returns bounds used for selection and hit-testing. */
  getBounds(model: TModel): BoardElementFrame;
}

/**
 * Registry for board element kinds and their reducer/bounds behavior.
 */
export class BoardElementRegistry {
  /** Registered element behavior by kind. */
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

/**
 * Creates the default registry used by the engine (note + image kinds).
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
