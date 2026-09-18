import assert from 'node:assert/strict';
import test from 'node:test';
import { sortConversations } from '../lib/conversation-sort.ts';

test('pins sort first while each group keeps latest-activity order', () => {
  const chats = [
    { id: 'old-pin', updatedAt: 10 },
    { id: 'new-normal', updatedAt: 40 },
    { id: 'new-pin', updatedAt: 30 },
    { id: 'old-normal', updatedAt: 20 },
  ];
  assert.deepEqual(
    sortConversations(chats, new Set(['old-pin', 'new-pin'])).map(
      ({ id }) => id,
    ),
    ['new-pin', 'old-pin', 'new-normal', 'old-normal'],
  );
  assert.deepEqual(
    sortConversations(chats, new Set()).map(({ id }) => id),
    ['new-normal', 'new-pin', 'old-normal', 'old-pin'],
  );
  assert.equal(chats[0].id, 'old-pin');
});
