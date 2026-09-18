import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

test('chat participants can reply and edit only their own text', async () => {
  const checkedRules = JSON.parse(readFileSync('database.rules.json', 'utf8'));
  assert.deepEqual(checkedRules.rules.users['.indexOn'], [
    'username',
    'displayName',
    'displayNameLower',
  ]);
  const environment = await initializeTestEnvironment({
    projectId: 'demo-relay',
    database: {
      host: '127.0.0.1',
      port: 9001,
      rules: readFileSync('database.rules.json', 'utf8'),
    },
  });
  try {
    const alice = environment.authenticatedContext('alice').database();
    const bob = environment.authenticatedContext('bob').database();
    const outsider = environment.authenticatedContext('outsider').database();
    const guest = environment.unauthenticatedContext().database();
    const chat = 'alice_bob';
    const path = `chats/${chat}`;
    await assertFails(guest.ref('users').get());
    await assertSucceeds(alice.ref('users').get());
    await assertSucceeds(
      alice
        .ref('users')
        .orderByChild('username')
        .startAt('bo')
        .endAt('bo\uf8ff')
        .limitToFirst(12)
        .get(),
    );
    await assertSucceeds(
      alice
        .ref('users')
        .orderByChild('displayNameLower')
        .startAt('bo')
        .endAt('bo\uf8ff')
        .limitToFirst(12)
        .get(),
    );
    await assertSucceeds(
      alice.ref(path).set({
        participants: { alice: true, bob: true },
        unread: { alice: 0, bob: 0 },
        updatedAt: Date.now(),
      }),
    );
    await assertFails(
      outsider.ref(`${path}/messages/hack`).set({
        sender: 'outsider',
        type: 'text',
        text: 'No',
        time: 1,
        seenBy: { outsider: true },
      }),
    );
    await assertFails(
      alice.ref(`${path}/messages/forgedReaction`).set({
        sender: 'alice',
        type: 'text',
        text: 'No forged reactions',
        time: 2,
        seenBy: { alice: true },
        reactions: { '❤️': { bob: true } },
      }),
    );
    await assertSucceeds(
      alice.ref(`${path}/messages/text1`).set({
        sender: 'alice',
        type: 'text',
        text: 'Hello',
        time: 100,
        seenBy: { alice: true },
      }),
    );
    await assertSucceeds(
      alice.ref().update({
        [`${path}/lastMessage`]: {
          id: 'text1',
          sender: 'alice',
          type: 'text',
          text: 'Hello',
          time: 100,
        },
        [`${path}/updatedAt`]: 100,
      }),
    );
    await assertSucceeds(bob.ref(`${path}/unread/alice`).set(1));
    await assertSucceeds(alice.ref(`${path}/unread/alice`).set(0));
    await assertSucceeds(bob.ref(`${path}/typing/bob`).set(Date.now()));
    await assertSucceeds(bob.ref(`${path}/typing/bob`).remove());
    await assertSucceeds(
      bob.ref(`${path}/messages/text1/seenBy/bob`).set(true),
    );
    await assertFails(bob.ref(`${path}/messages/text1/text`).set('Tampered'));
    await assertFails(bob.ref(`${path}/messages/text1/editedAt`).set(200));
    await assertFails(alice.ref(`${path}/messages/text1/sender`).set('bob'));
    await assertFails(alice.ref(`${path}/messages/text1/time`).set(200));
    await assertSucceeds(
      alice.ref().update({
        [`${path}/messages/text1/text`]: 'Edited',
        [`${path}/messages/text1/editedAt`]: 200,
      }),
    );
    await assertSucceeds(alice.ref(`${path}/lastMessage/text`).set('Edited'));
    await assertSucceeds(
      bob.ref(`${path}/messages/photo1`).set({
        sender: 'bob',
        type: 'image',
        text: '',
        imageURL: 'https://example.com/a.jpg',
        time: 250,
        seenBy: { bob: true },
      }),
    );
    await assertFails(
      bob.ref(`${path}/messages/photo1/text`).set('No editing images'),
    );
    await assertSucceeds(
      bob.ref(`${path}/messages/reply1`).set({
        sender: 'bob',
        type: 'text',
        text: 'Thanks',
        time: 300,
        seenBy: { bob: true },
        replyTo: {
          messageId: 'text1',
          senderId: 'alice',
          type: 'text',
          text: 'Hello',
        },
      }),
    );
    await assertFails(
      bob.ref(`${path}/messages/badReply`).set({
        sender: 'bob',
        type: 'text',
        text: 'Fake',
        time: 301,
        seenBy: { bob: true },
        replyTo: {
          messageId: 'missing',
          senderId: 'alice',
          type: 'text',
          text: 'Fake',
        },
      }),
    );
    await assertFails(bob.ref(`${path}/messages/text1`).remove());
    await environment.withSecurityRulesDisabled((context) =>
      context.database().ref(`${path}/messages/legacy`).set({
        sender: 'alice',
        text: 'Old message',
        time: 50,
      }),
    );
    await assertSucceeds(
      alice.ref(`${path}/messages/legacy/text`).set('Updated old message'),
    );
    await assertFails(bob.ref(`${path}/messages/legacy/text`).set('Not yours'));
    const heart = `${path}/messages/text1/reactions/❤️`;
    await assertSucceeds(alice.ref(`${heart}/alice`).set(true));
    await assertSucceeds(bob.ref(`${heart}/bob`).set(true));
    assert.deepEqual((await alice.ref(heart).get()).val(), {
      alice: true,
      bob: true,
    });
    await assertSucceeds(
      alice.ref(`${path}/messages/text1/reactions/😂/alice`).set(true),
    );
    await assertSucceeds(alice.ref(`${heart}/alice`).remove());
    assert.equal((await bob.ref(`${heart}/bob`).get()).val(), true);
    await assertSucceeds(
      alice.ref(`${path}/messages/photo1/reactions/🙂/alice`).set(true),
    );
    await assertSucceeds(
      bob.ref(`${path}/messages/reply1/reactions/💖/bob`).set(true),
    );
    await assertSucceeds(
      bob.ref(`${path}/messages/legacy/reactions/😭/bob`).set(true),
    );
    await assertFails(outsider.ref(`${heart}/outsider`).set(true));
    await assertFails(guest.ref(`${heart}/guest`).set(true));
    await assertFails(alice.ref(`${heart}/bob`).remove());
    await assertFails(bob.ref(`${heart}/alice`).set(true));
    await assertFails(
      alice.ref(`${path}/messages/text1/reactions/👎/alice`).set(true),
    );
    await assertFails(
      alice.ref(`${path}/messages/missing/reactions/❤️/alice`).set(true),
    );
    await assertFails(alice.ref(`${path}/messages/text1/sender`).set('bob'));

    await assertFails(guest.ref('userPins/alice').get());
    await assertSucceeds(alice.ref(`userPins/alice/${chat}`).set(true));
    assert.equal((await alice.ref(`userPins/alice/${chat}`).get()).val(), true);
    await assertFails(bob.ref(`userPins/alice/${chat}`).get());
    assert.equal((await bob.ref(`userPins/bob/${chat}`).get()).exists(), false);
    await assertFails(bob.ref(`userPins/alice/${chat}`).set(true));
    await assertFails(outsider.ref(`userPins/outsider/${chat}`).set(true));
    await assertSucceeds(bob.ref(`userPins/bob/${chat}`).set(true));
    await assertSucceeds(alice.ref(`userPins/alice/${chat}`).remove());
    assert.equal(
      (await alice.ref(`userPins/alice/${chat}`).get()).exists(),
      false,
    );
  } finally {
    await environment.cleanup();
  }
});
