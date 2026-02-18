export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/* 📖 # Why keep frame geometry and handles element-agnostic?
Multiple board element types can share the same drag/resize mechanics.
Extracting frame math and handle drawing avoids duplicating interaction code per element kind.
*/

export interface PointerDelta {
  x: number;
  y: number;
}

export interface MinimumSize {
  width: number;
  height: number;
}

export type ResizeHandlePosition =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left';

export const ALL_RESIZE_HANDLES: readonly ResizeHandlePosition[] = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left'
] as const;

export function moveFrame(frame: FrameRect, pointerDelta: PointerDelta): FrameRect {
  return {
    ...frame,
    x: frame.x + pointerDelta.x,
    y: frame.y + pointerDelta.y
  };
}

export function resizeFrame(
  frame: FrameRect,
  pointerDelta: PointerDelta,
  handle: ResizeHandlePosition,
  minimumSize: MinimumSize
): FrameRect {
  const next = { ...frame };

  if (handle.includes('right')) {
    next.width = Math.max(minimumSize.width, frame.width + pointerDelta.x);
  }

  if (handle.includes('left')) {
    const nextWidth = Math.max(minimumSize.width, frame.width - pointerDelta.x);
    next.x = frame.x + (frame.width - nextWidth);
    next.width = nextWidth;
  }

  if (handle.includes('bottom')) {
    next.height = Math.max(minimumSize.height, frame.height + pointerDelta.y);
  }

  if (handle.includes('top')) {
    const nextHeight = Math.max(minimumSize.height, frame.height - pointerDelta.y);
    next.y = frame.y + (frame.height - nextHeight);
    next.height = nextHeight;
  }

  return next;
}

export function applyFrameLayout(node: HTMLElement, frame: FrameRect) {
  node.style.left = `${frame.x}px`;
  node.style.top = `${frame.y}px`;
  node.style.width = `${frame.width}px`;
  node.style.height = `${frame.height}px`;
}

export function createResizeHandle(position: ResizeHandlePosition) {
  const handle = document.createElement('div');
  handle.dataset.resizeHandle = position;
  handle.style.position = 'absolute';
  handle.style.borderRadius = '4px';
  handle.style.background = 'rgba(22, 95, 153, 0.52)';
  handle.style.touchAction = 'none';
  handle.style.zIndex = '2';

  if (position === 'top-left') {
    handle.style.left = '-8px';
    handle.style.top = '-8px';
    handle.style.width = '16px';
    handle.style.height = '16px';
    handle.style.cursor = 'nwse-resize';
  } else if (position === 'top') {
    handle.style.left = '50%';
    handle.style.top = '-4px';
    handle.style.transform = 'translateX(-50%)';
    handle.style.width = '26px';
    handle.style.height = '8px';
    handle.style.cursor = 'ns-resize';
  } else if (position === 'top-right') {
    handle.style.right = '-8px';
    handle.style.top = '-8px';
    handle.style.width = '16px';
    handle.style.height = '16px';
    handle.style.cursor = 'nesw-resize';
  } else if (position === 'right') {
    handle.style.right = '-4px';
    handle.style.top = '50%';
    handle.style.transform = 'translateY(-50%)';
    handle.style.width = '8px';
    handle.style.height = '26px';
    handle.style.cursor = 'ew-resize';
  } else if (position === 'bottom-right') {
    handle.style.right = '-8px';
    handle.style.bottom = '-8px';
    handle.style.width = '16px';
    handle.style.height = '16px';
    handle.style.cursor = 'nwse-resize';
  } else if (position === 'bottom') {
    handle.style.left = '50%';
    handle.style.bottom = '-4px';
    handle.style.transform = 'translateX(-50%)';
    handle.style.width = '26px';
    handle.style.height = '8px';
    handle.style.cursor = 'ns-resize';
  } else if (position === 'bottom-left') {
    handle.style.left = '-8px';
    handle.style.bottom = '-8px';
    handle.style.width = '16px';
    handle.style.height = '16px';
    handle.style.cursor = 'nesw-resize';
  } else if (position === 'left') {
    handle.style.left = '-4px';
    handle.style.top = '50%';
    handle.style.transform = 'translateY(-50%)';
    handle.style.width = '8px';
    handle.style.height = '26px';
    handle.style.cursor = 'ew-resize';
  }

  return handle;
}
