import assert from 'node:assert/strict';
import test from 'node:test';
import { emojiSize } from '../lib/emoji.ts';

test('counts visible emoji graphemes, not UTF-16 code units', () => {
  for (const value of ['😂', '❤️', '👍🏽', '🇮🇳', '👨‍👩‍👧‍👦', '1️⃣'])
    assert.equal(emojiSize(value), 'one', value);
  assert.equal(emojiSize('💖 💗'), 'few');
  assert.equal(emojiSize('😭😭😭'), 'few');
  assert.equal(emojiSize('🙂 🙂 🙂 🙂'), 'several');
  assert.equal(emojiSize('😂'.repeat(6)), 'several');
  assert.equal(emojiSize('😂'.repeat(7)), null);
  for (const value of ['hello ❤️', '😂 lol', '123', '!', ''])
    assert.equal(emojiSize(value), null, value);
});
