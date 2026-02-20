import { applyFrameLayout } from './elementFrame';
import type { BoardLinkElement } from './engine/boardEngineTypes';

export type LinkElement = BoardLinkElement;

export interface LinkRecord {
  model: LinkElement;
  node: HTMLDivElement;
  applyModel: (model: LinkElement) => void;
}

export interface LinkBoardCallbacks {
  beginSelectionDrag: (event: PointerEvent, elementId: string) => void;
}

const LINK_CARD_BODY_HEIGHT = 96;

function getHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Creates and renders a link card element record.
 */
export function createLinkRecord(
  element: LinkElement,
  options: {
    applyLayout?: (node: HTMLElement, frame: LinkElement) => void;
  } = {}
): LinkRecord {
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
  node.style.display = 'grid';
  node.style.gridTemplateRows = '1fr';

  const previewImage = document.createElement('img');
  previewImage.style.display = 'none';
  previewImage.style.width = '100%';
  previewImage.style.height = '100%';
  previewImage.style.objectFit = 'cover';
  previewImage.style.pointerEvents = 'none';
  previewImage.draggable = false;
  previewImage.dataset.testid = `link-preview-${model.id}`;

  const body = document.createElement('div');
  body.style.padding = '10px 12px';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.gap = '4px';
  body.style.height = '100%';
  body.style.boxSizing = 'border-box';
  body.style.minHeight = '0';

  const title = document.createElement('a');
  title.style.fontFamily = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
  title.style.fontWeight = '600';
  title.style.fontSize = '15px';
  title.style.lineHeight = '1.35';
  title.style.color = '#0f3b61';
  title.style.textDecoration = 'none';
  title.style.overflow = 'hidden';
  title.style.display = '-webkit-box';
  title.style.webkitLineClamp = '1';
  title.style.webkitBoxOrient = 'vertical';
  title.style.minHeight = '1.35em';
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.dataset.testid = `link-title-${model.id}`;

  const description = document.createElement('div');
  description.style.fontFamily = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
  description.style.fontSize = '12px';
  description.style.lineHeight = '1.35';
  description.style.color = '#376082';
  description.style.overflow = 'hidden';
  description.style.display = '-webkit-box';
  description.style.webkitLineClamp = '2';
  description.style.webkitBoxOrient = 'vertical';
  description.style.minHeight = '2.7em';

  const hostname = document.createElement('div');
  hostname.style.marginTop = 'auto';
  hostname.style.fontFamily = '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif';
  hostname.style.fontSize = '11px';
  hostname.style.fontWeight = '600';
  hostname.style.letterSpacing = '0.03em';
  hostname.style.textTransform = 'uppercase';
  hostname.style.color = '#5c86a8';
  hostname.style.overflow = 'hidden';
  hostname.style.textOverflow = 'ellipsis';
  hostname.style.whiteSpace = 'nowrap';

  const applyModel = (nextModel: LinkElement) => {
    record.model = { ...nextModel };
    title.textContent = nextModel.title;
    title.href = nextModel.url;
    description.textContent = nextModel.description ?? '';
    description.style.display = nextModel.description ? '-webkit-box' : 'none';
    hostname.textContent = getHostname(nextModel.url);
    if (nextModel.imageSrc) {
      previewImage.style.display = 'block';
      previewImage.src = nextModel.imageSrc;
      previewImage.alt = nextModel.title;
      node.style.gridTemplateRows = `minmax(0, 1fr) ${LINK_CARD_BODY_HEIGHT}px`;
    } else {
      previewImage.style.display = 'none';
      previewImage.removeAttribute('src');
      previewImage.alt = '';
      node.style.gridTemplateRows = '1fr';
    }
  };

  body.append(title, description, hostname);
  node.append(previewImage, body);

  const record: LinkRecord = {
    model,
    node,
    applyModel
  };
  applyLayout(node, model);
  applyModel(model);

  return record;
}

/**
 * Creates and wires a board link element with link-specific interaction behavior.
 */
export function createBoardLinkRecord(
  element: LinkElement,
  options: {
    applyLayout: (node: HTMLElement, frame: LinkElement) => void;
    callbacks: LinkBoardCallbacks;
  }
): LinkRecord {
  const link = createLinkRecord(element, {
    applyLayout: options.applyLayout
  });

  link.node.addEventListener('pointerdown', (event) => {
    options.callbacks.beginSelectionDrag(event, link.model.id);
  });

  return link;
}
