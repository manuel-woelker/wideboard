import { applyFrameLayout } from './elementFrame';
import type { BoardImageElement } from './engine/boardEngineTypes';

export type ImageElement = BoardImageElement;

export interface ImageRecord {
  model: ImageElement;
  node: HTMLDivElement;
}

export interface ImageBoardCallbacks {
  beginSelectionDrag: (event: PointerEvent, elementId: string) => void;
}

/* 📖 # Why keep image element rendering separate from notes?
Image cards share board geometry behavior but do not need text editing or auto-fit logic.
Splitting the module avoids adding note-specific behavior to image elements.
*/
export function createImageRecord(
  element: ImageElement,
  options: {
    applyLayout?: (node: HTMLElement, frame: ImageElement) => void;
  } = {}
): ImageRecord {
  const applyLayout = options.applyLayout ?? applyFrameLayout;
  const model = { ...element };

  const node = document.createElement('div');
  node.dataset.elementId = model.id;
  node.style.position = 'absolute';
  node.style.boxSizing = 'border-box';
  node.style.border = '1px solid rgba(25, 79, 125, 0.32)';
  node.style.borderRadius = '10px';
  node.style.background = 'rgba(247, 253, 255, 0.95)';
  node.style.boxShadow = '0 10px 24px rgba(25, 79, 125, 0.14)';
  node.style.overflow = 'hidden';
  node.style.touchAction = 'none';
  node.style.cursor = 'grab';

  const image = document.createElement('img');
  image.src = model.src;
  image.alt = model.alt;
  image.dataset.testid = `image-element-${model.id}`;
  image.style.display = 'block';
  image.style.width = '100%';
  image.style.height = '100%';
  image.style.objectFit = 'cover';
  image.style.pointerEvents = 'none';
  image.draggable = false;

  node.append(image);
  applyLayout(node, model);

  return {
    model,
    node
  };
}

/**
 * Creates and wires a board image element with image-specific interaction behavior.
 */
export function createBoardImageRecord(
  element: ImageElement,
  options: {
    applyLayout: (node: HTMLElement, frame: ImageElement) => void;
    callbacks: ImageBoardCallbacks;
  }
): ImageRecord {
  const image = createImageRecord(element, {
    applyLayout: options.applyLayout
  });

  image.node.addEventListener('pointerdown', (event) => {
    options.callbacks.beginSelectionDrag(event, image.model.id);
  });

  return image;
}
