type Bounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

const EDGE = 4;
const OVERLAP = 4;

export function placeMessageToolbar(
  bubble: Bounds,
  message: Bounds,
  viewport: Bounds,
  width: number,
  height: number,
) {
  const above = bubble.top - height + OVERLAP;
  const below = message.bottom - OVERLAP;
  const preferredTop = above >= viewport.top + EDGE ? above : below;
  const screenTop = Math.max(
    viewport.top + EDGE,
    Math.min(preferredTop, viewport.bottom - height - EDGE),
  );
  const preferredLeft = bubble.right - width - 5;
  const screenLeft = Math.max(
    viewport.left + EDGE,
    Math.min(preferredLeft, viewport.right - width - EDGE),
  );
  return {
    top: screenTop - bubble.top,
    left: screenLeft - bubble.left,
    placement: above >= viewport.top + EDGE ? 'above' : 'below',
  } as const;
}
