import assert from 'node:assert/strict';
import test from 'node:test';
import { placeMessageToolbar } from '../lib/message-toolbar.ts';

const viewport = { left: 12, right: 308, top: 70, bottom: 570 };
const size = { width: 122, height: 40 };

function screenPosition(bubble, message) {
  const position = placeMessageToolbar(
    bubble,
    message,
    viewport,
    size.width,
    size.height,
  );
  const left = bubble.left + position.left;
  const top = bubble.top + position.top;
  assert.ok(left >= viewport.left + 4);
  assert.ok(left + size.width <= viewport.right - 4);
  assert.ok(top >= viewport.top + 4);
  assert.ok(top + size.height <= viewport.bottom - 4);
  return { ...position, left, top };
}

test('topmost incoming and outgoing toolbars move below and stay inside a narrow chat', () => {
  const incoming = { left: 58, right: 102, top: 78, bottom: 111 };
  const outgoing = { left: 250, right: 296, top: 78, bottom: 111 };
  const incomingPosition = screenPosition(incoming, incoming);
  const outgoingPosition = screenPosition(outgoing, outgoing);
  assert.equal(incomingPosition.placement, 'below');
  assert.equal(outgoingPosition.placement, 'below');
  assert.ok(incomingPosition.top >= incoming.bottom - 4);
  assert.ok(outgoingPosition.top >= outgoing.bottom - 4);
});

test('normal messages keep the toolbar above; bottom-edge messages remain visible', () => {
  const middle = { left: 120, right: 220, top: 250, bottom: 310 };
  const middlePosition = screenPosition(middle, middle);
  assert.equal(middlePosition.placement, 'above');
  assert.ok(middlePosition.top < middle.top);

  const bottom = { left: 58, right: 150, top: 530, bottom: 562 };
  const bottomPosition = screenPosition(bottom, bottom);
  assert.equal(bottomPosition.placement, 'above');
});

test('toolbar is clamped inside an extra-narrow mobile viewport', () => {
  const narrow = { left: 0, right: 180, top: 58, bottom: 420 };
  for (const bubble of [
    { left: 42, right: 70, top: 62, bottom: 100 },
    { left: 143, right: 176, top: 62, bottom: 100 },
  ]) {
    const position = placeMessageToolbar(bubble, bubble, narrow, 122, 40);
    const left = bubble.left + position.left;
    const top = bubble.top + position.top;
    assert.equal(position.placement, 'below');
    assert.ok(left >= 4 && left + 122 <= 176);
    assert.ok(top >= 62 && top + 40 <= 416);
  }
});
