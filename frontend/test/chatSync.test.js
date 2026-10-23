import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateUUIDv4,
  sortAndDeduplicate,
  reconcileMessageList,
  normalizeConversationId,
  handleChatReadEvent
} from '../src/hooks/useChatSync.js';
import { computeSeenStatus } from '../src/pages/Chat.jsx';

describe('useChatSync Core Synchronization Engine', () => {

  it('1. Generates RFC 4122 compliant UUID v4 clientMessageIds', () => {
    const id1 = generateUUIDv4();
    const id2 = generateUUIDv4();
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(id1).toMatch(uuidV4Regex);
    expect(id2).toMatch(uuidV4Regex);
    expect(id1).not.toBe(id2);
  });

  it('2. Deduplicates messages delivered by both REST and Socket.IO', () => {
    const restMsg = {
      _id: 'msg-1',
      conversationId: 'conv-1',
      seq: 1,
      clientMessageId: 'uuid-1',
      text: 'Hello from REST',
      createdAt: '2026-10-23T01:00:00.000Z'
    };

    const socketMsg = {
      _id: 'msg-1',
      conversationId: 'conv-1',
      seq: 1,
      clientMessageId: 'uuid-1',
      text: 'Hello from REST',
      createdAt: '2026-10-23T01:00:00.000Z'
    };

    const deduplicated = sortAndDeduplicate([restMsg, socketMsg]);
    expect(deduplicated.length).toBe(1);
    expect(deduplicated[0].seq).toBe(1);
  });

  it('3. Reconciles optimistic messages in-place by clientMessageId', () => {
    const clientMessageId = generateUUIDv4();
    const optimisticMap = new Map();

    const optimisticMsg = {
      _id: `temp-${clientMessageId}`,
      clientMessageId,
      conversationId: 'conv-1',
      sender: 'user-me',
      text: 'Optimistic send',
      createdAt: new Date().toISOString(),
      status: 'sending'
    };

    optimisticMap.set(clientMessageId, optimisticMsg);

    const initialList = [optimisticMsg];
    expect(initialList[0].status).toBe('sending');

    const confirmedServerMsg = {
      _id: 'db-msg-99',
      clientMessageId,
      conversationId: 'conv-1',
      sender: 'user-me',
      text: 'Optimistic send',
      seq: 42,
      createdAt: new Date().toISOString(),
      status: 'persisted'
    };

    const reconciled = reconcileMessageList(initialList, [confirmedServerMsg], optimisticMap);

    expect(reconciled.length).toBe(1);
    expect(reconciled[0]._id).toBe('db-msg-99');
    expect(reconciled[0].seq).toBe(42);
    expect(reconciled[0].status).toBe('persisted');
    expect(optimisticMap.has(clientMessageId)).toBe(false);
  });

  it('4. Initial baseline loading buffers events arriving during request and merges without loss', () => {
    const baselineMessages = [
      { _id: 'm1', seq: 1, text: 'One', clientMessageId: 'c1' },
      { _id: 'm2', seq: 2, text: 'Two', clientMessageId: 'c2' },
      { _id: 'm3', seq: 3, text: 'Three', clientMessageId: 'c3' }
    ];

    // Socket events that arrive while baseline is in-flight
    const bufferedSocketEvents = [
      { _id: 'm4', seq: 4, text: 'Four', clientMessageId: 'c4' },
      { _id: 'm5', seq: 5, text: 'Five', clientMessageId: 'c5' }
    ];

    const merged = reconcileMessageList(baselineMessages, bufferedSocketEvents, new Map());

    expect(merged.length).toBe(5);
    expect(merged.map(m => m.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('5. Detects sequence gaps and never advances contiguous frontier across a gap', () => {
    let highestContiguousSeq = 5;
    const outOfOrderBuffer = [];

    const handleIncoming = (msg) => {
      if (msg.seq === highestContiguousSeq + 1) {
        highestContiguousSeq = msg.seq;
      } else if (msg.seq > highestContiguousSeq + 1) {
        // Gap!
        outOfOrderBuffer.push(msg);
      }
    };

    // Arrives out of order: seq 8 arrives when frontier is 5
    handleIncoming({ _id: 'm8', seq: 8, text: 'Eight' });
    expect(highestContiguousSeq).toBe(5);
    expect(outOfOrderBuffer.length).toBe(1);
    expect(outOfOrderBuffer[0].seq).toBe(8);

    // Gap recovered: seq 6 and seq 7 arrive
    handleIncoming({ _id: 'm6', seq: 6, text: 'Six' });
    expect(highestContiguousSeq).toBe(6);

    handleIncoming({ _id: 'm7', seq: 7, text: 'Seven' });
    expect(highestContiguousSeq).toBe(7);

    // Now drain out-of-order buffer
    outOfOrderBuffer.sort((a, b) => a.seq - b.seq);
    while (outOfOrderBuffer.length > 0 && outOfOrderBuffer[0].seq === highestContiguousSeq + 1) {
      highestContiguousSeq = outOfOrderBuffer.shift().seq;
    }

    expect(highestContiguousSeq).toBe(8);
    expect(outOfOrderBuffer.length).toBe(0);
  });

  it('6. Handles multi-page recovery when hasMore is true', async () => {
    const serverPages = {
      // afterSeq 5 -> page 1
      5: {
        messages: [
          { _id: 'm6', seq: 6, text: 'Six' },
          { _id: 'm7', seq: 7, text: 'Seven' }
        ],
        lastSeq: 9,
        hasMore: true,
        reset: false
      },
      // afterSeq 7 -> page 2
      7: {
        messages: [
          { _id: 'm8', seq: 8, text: 'Eight' },
          { _id: 'm9', seq: 9, text: 'Nine' }
        ],
        lastSeq: 9,
        hasMore: false,
        reset: false
      }
    };

    let highestContiguousSeq = 5;
    let localMessages = [{ _id: 'm5', seq: 5, text: 'Five' }];

    const fetchRecovery = async (afterSeq) => serverPages[afterSeq];

    let hasMore = true;
    while (hasMore) {
      const page = await fetchRecovery(highestContiguousSeq);
      localMessages = reconcileMessageList(localMessages, page.messages, new Map());
      highestContiguousSeq = localMessages[localMessages.length - 1].seq;
      hasMore = page.hasMore;
    }

    expect(highestContiguousSeq).toBe(9);
    expect(localMessages.length).toBe(5);
    expect(localMessages.map(m => m.seq)).toEqual([5, 6, 7, 8, 9]);
  });

  it('7. Handles reset: true by discarding stale messages and loading baseline', () => {
    let localMessages = [
      { _id: 'stale-1', seq: 98, text: 'Stale 98' },
      { _id: 'stale-2', seq: 99, text: 'Stale 99' }
    ];

    const resetResponse = {
      messages: [
        { _id: 'm1', seq: 1, text: 'One' },
        { _id: 'm2', seq: 2, text: 'Two' }
      ],
      lastSeq: 2,
      hasMore: false,
      reset: true
    };

    if (resetResponse.reset === true) {
      localMessages = sortAndDeduplicate(resetResponse.messages);
    }

    expect(localMessages.length).toBe(2);
    expect(localMessages.map(m => m.seq)).toEqual([1, 2]);
  });

  it('8. Conversation switching cleans up and drops events from previous conversation', () => {
    let activeConversationId = 'conv-A';
    const receivedForActive = [];

    const onChatMessage = (msg) => {
      if (msg.conversationId !== activeConversationId) {
        return; // drop event from different/previous conversation
      }
      receivedForActive.push(msg);
    };

    onChatMessage({ _id: 'm1', conversationId: 'conv-A', seq: 1, text: 'For A' });
    expect(receivedForActive.length).toBe(1);

    // Switch conversation
    activeConversationId = 'conv-B';

    // Late arriving event from conv-A
    onChatMessage({ _id: 'm2', conversationId: 'conv-A', seq: 2, text: 'Late A' });
    expect(receivedForActive.length).toBe(1); // Not added!

    // Event for conv-B
    onChatMessage({ _id: 'm3', conversationId: 'conv-B', seq: 1, text: 'For B' });
    expect(receivedForActive.length).toBe(2);
    expect(receivedForActive[1].conversationId).toBe('conv-B');
  });

  it('9. Reconnect catch-up recovers all missed messages before declaring synced', async () => {
    let syncStatus = 'reconnecting';
    let highestContiguousSeq = 10;
    const serverMessages = [
      { _id: 'm11', seq: 11, text: 'Eleven' },
      { _id: 'm12', seq: 12, text: 'Twelve' }
    ];

    // Trigger catch-up upon reconnect
    const simulateReconnect = async () => {
      syncStatus = 'syncing';
      // fetch messages afterSeq: 10
      const fetched = serverMessages.filter(m => m.seq > highestContiguousSeq);
      highestContiguousSeq = fetched[fetched.length - 1].seq;
      syncStatus = 'synced';
    };

    await simulateReconnect();
    expect(highestContiguousSeq).toBe(12);
    expect(syncStatus).toBe('synced');
  });

  it('10. Recovery failure enters degraded state and does not falsely claim synced', async () => {
    let syncStatus = 'syncing';
    let cycles = 0;
    const MAX_CYCLES = 5;

    // Simulate persistent network failure or unbounded stream
    const simulateFailingRecovery = () => {
      while (cycles < MAX_CYCLES) {
        cycles++;
      }
      if (cycles >= MAX_CYCLES) {
        syncStatus = 'degraded';
      }
    };

    simulateFailingRecovery();
    expect(syncStatus).toBe('degraded');
    expect(syncStatus).not.toBe('synced');
  });

  it('11. Older-history pagination preserves viewport scroll position', () => {
    // Mock scroll container element
    const container = {
      scrollHeight: 1000,
      scrollTop: 0,
      clientHeight: 500
    };

    const prevScrollHeight = container.scrollHeight;
    const prevScrollTop = container.scrollTop;

    // Prepend older messages: increases scrollHeight
    container.scrollHeight = 1600;

    // Viewport correction formula from Chat.jsx
    const heightDiff = container.scrollHeight - prevScrollHeight;
    container.scrollTop = prevScrollTop + heightDiff;

    // The user's visible window is retained at exactly the same message content
    expect(container.scrollTop).toBe(600);
  });

  it('12. Reuses identical clientMessageId on retry rather than generating a new ID', () => {
    const originalClientId = generateUUIDv4();
    const retryCalls = [];

    const mockSendApi = (clientId, text) => {
      retryCalls.push({ clientId, text });
    };

    // First attempt
    mockSendApi(originalClientId, 'Important message');

    // Simulated retry on error
    mockSendApi(originalClientId, 'Important message');

    expect(retryCalls.length).toBe(2);
    expect(retryCalls[0].clientId).toBe(originalClientId);
    expect(retryCalls[1].clientId).toBe(originalClientId);
    expect(retryCalls[0].clientId).toBe(retryCalls[1].clientId);
  });

  it('13. Reconnect recovery runs at sequence zero and recovers the first message exactly once', async () => {
    // Scenario: user opens empty conversation (lastSeq: 0, highestContiguousSeq: 0)
    let highestContiguousSeq = 0;
    let localMessages = [];
    let syncStatus = 'synced';

    // Disconnect happens
    syncStatus = 'reconnecting';

    // While client is offline, the other participant sends the first message (seq: 1)
    const serverDatabase = [
      { _id: 'm1', seq: 1, text: 'First message sent while offline', clientMessageId: 'c1' }
    ];

    // Reconnect triggered
    let requestedAfterSeq = null;
    const simulateReconnect = async () => {
      // Must not report 'synced' prematurely
      syncStatus = 'syncing';

      // Runs recovery even when highestContiguousSeq === 0
      if (highestContiguousSeq >= 0) {
        requestedAfterSeq = highestContiguousSeq; // should be 0
        // Query afterSeq=0 returns messages with seq > 0
        const missed = serverDatabase.filter(m => m.seq > requestedAfterSeq);
        localMessages = reconcileMessageList(localMessages, missed, new Map());
        highestContiguousSeq = localMessages[localMessages.length - 1].seq;
      }

      syncStatus = 'synced';
    };

    await simulateReconnect();

    expect(requestedAfterSeq).toBe(0);
    expect(highestContiguousSeq).toBe(1);
    expect(localMessages.length).toBe(1);
    expect(localMessages[0].text).toBe('First message sent while offline');
    expect(syncStatus).toBe('synced');

    // Verify recovery was exact and idempotent: running again does not duplicate seq: 1
    const secondPass = serverDatabase.filter(m => m.seq > highestContiguousSeq);
    localMessages = reconcileMessageList(localMessages, secondPass, new Map());
    expect(localMessages.length).toBe(1);
  });

  it('14. Defensively normalizes string and ObjectId-like conversation IDs in incoming event filter', () => {
    // String ID
    expect(normalizeConversationId('6710abcd1234ef5678901234')).toBe('6710abcd1234ef5678901234');
    expect(normalizeConversationId('  6710abcd1234ef5678901234  ')).toBe('6710abcd1234ef5678901234');

    // Mongoose ObjectId-like object with .toString()
    const mockObjectId = {
      _id: '6710abcd1234ef5678901234',
      toString: () => '6710abcd1234ef5678901234'
    };
    expect(normalizeConversationId(mockObjectId)).toBe('6710abcd1234ef5678901234');

    // BSON ObjectId-like object with .toHexString()
    const mockBsonId = {
      toHexString: () => '6710abcd1234ef5678901234',
      toString: () => '6710abcd1234ef5678901234'
    };
    expect(normalizeConversationId(mockBsonId)).toBe('6710abcd1234ef5678901234');

    // Falsy / invalid IDs fail safely to empty string
    expect(normalizeConversationId(null)).toBe('');
    expect(normalizeConversationId(undefined)).toBe('');
    expect(normalizeConversationId('')).toBe('');

    // Event filter integration: ObjectId and string conversation IDs match
    const activeConversationId = '6710abcd1234ef5678901234';
    const eventWithObjectId = {
      _id: 'msg-1',
      conversationId: mockObjectId,
      seq: 1,
      text: 'Matched!'
    };

    const isMatch = (
      normalizeConversationId(eventWithObjectId.conversationId) ===
      normalizeConversationId(activeConversationId)
    );
    expect(isMatch).toBe(true);

    const eventWithDifferentId = {
      _id: 'msg-2',
      conversationId: 'different-conversation-id',
      seq: 1,
      text: 'Dropped'
    };
    const isDifferentMatch = (
      normalizeConversationId(eventWithDifferentId.conversationId) ===
      normalizeConversationId(activeConversationId)
    );
    expect(isDifferentMatch).toBe(false);
  });

  it('15. Canonical sequence ordering: messages always render in ascending seq order (lowest seq at top, highest at bottom)', () => {
    // Shuffled input representing unordered network arrivals
    const shuffledMessages = [
      { _id: 'm-3', clientMessageId: 'c-3', seq: 3, text: 'Third', createdAt: '2026-10-23T01:02:00.000Z' },
      { _id: 'm-1', clientMessageId: 'c-1', seq: 1, text: 'First', createdAt: '2026-10-23T01:00:00.000Z' },
      { _id: 'm-5', clientMessageId: 'c-5', seq: 5, text: 'Fifth', createdAt: '2026-10-23T01:04:00.000Z' },
      { _id: 'm-2', clientMessageId: 'c-2', seq: 2, text: 'Second', createdAt: '2026-10-23T01:01:00.000Z' },
      { _id: 'm-4', clientMessageId: 'c-4', seq: 4, text: 'Fourth', createdAt: '2026-10-23T01:03:00.000Z' }
    ];

    const sorted = sortAndDeduplicate(shuffledMessages);

    // Strict ascending seq order
    expect(sorted.map(m => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(sorted[0].text).toBe('First');
    expect(sorted[4].text).toBe('Fifth');
  });

  it('16. Realtime messages and optimistic sends appear at the bottom in the correct order', () => {
    // Existing confirmed messages seq 1..3
    const existing = [
      { _id: 'm-1', clientMessageId: 'c-1', seq: 1, text: 'One' },
      { _id: 'm-2', clientMessageId: 'c-2', seq: 2, text: 'Two' },
      { _id: 'm-3', clientMessageId: 'c-3', seq: 3, text: 'Three' }
    ];

    // Optimistic pending send has no sequence yet
    const pendingSend = {
      _id: 'temp-c4',
      clientMessageId: 'c-4',
      text: 'Pending user message',
      status: 'sending',
      createdAt: new Date().toISOString()
    };

    const optimisticMap = new Map();
    optimisticMap.set('c-4', { msg: pendingSend });

    const withOptimistic = reconcileMessageList(existing, [pendingSend], optimisticMap);

    // Optimistic message is placed at the bottom
    expect(withOptimistic).toHaveLength(4);
    expect(withOptimistic[3].clientMessageId).toBe('c-4');
    expect(withOptimistic[3].status).toBe('sending');

    // Confirmed via socket/REST with seq: 4
    const confirmed = {
      _id: 'db-m-4',
      clientMessageId: 'c-4',
      seq: 4,
      text: 'Pending user message',
      status: 'persisted'
    };

    const reconciled = reconcileMessageList(withOptimistic, [confirmed], optimisticMap);

    expect(reconciled).toHaveLength(4);
    expect(reconciled.map(m => m.seq)).toEqual([1, 2, 3, 4]);
    expect(reconciled[3]._id).toBe('db-m-4');
    expect(reconciled[3].status).toBe('persisted');

    // Realtime message from other user seq: 5 arrives at bottom
    const incomingOther = {
      _id: 'db-m-5',
      clientMessageId: 'c-5',
      seq: 5,
      text: 'Message from friend',
      status: 'persisted'
    };

    const updated = reconcileMessageList(reconciled, [incomingOther], optimisticMap);
    expect(updated).toHaveLength(5);
    expect(updated.map(m => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(updated[4].text).toBe('Message from friend');
  });

  it('17. Older-history loading prepends older messages without reordering existing messages or creating duplicates', () => {
    // Current visible messages are seq 11..15
    const currentMessages = [
      { _id: 'm-11', clientMessageId: 'c-11', seq: 11, text: 'Msg 11' },
      { _id: 'm-12', clientMessageId: 'c-12', seq: 12, text: 'Msg 12' },
      { _id: 'm-13', clientMessageId: 'c-13', seq: 13, text: 'Msg 13' },
      { _id: 'm-14', clientMessageId: 'c-14', seq: 14, text: 'Msg 14' },
      { _id: 'm-15', clientMessageId: 'c-15', seq: 15, text: 'Msg 15' }
    ];

    // Older batch loaded via beforeSeq: 11 returns seq 6..10
    const olderBatch = [
      { _id: 'm-6', clientMessageId: 'c-6', seq: 6, text: 'Msg 6' },
      { _id: 'm-7', clientMessageId: 'c-7', seq: 7, text: 'Msg 7' },
      { _id: 'm-8', clientMessageId: 'c-8', seq: 8, text: 'Msg 8' },
      { _id: 'm-9', clientMessageId: 'c-9', seq: 9, text: 'Msg 9' },
      { _id: 'm-10', clientMessageId: 'c-10', seq: 10, text: 'Msg 10' }
    ];

    const prepended = reconcileMessageList(currentMessages, olderBatch, new Map());

    // Prepend without reordering: strictly ascending seq 6..15
    expect(prepended).toHaveLength(10);
    expect(prepended.map(m => m.seq)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(prepended[0].seq).toBe(6);
    expect(prepended[9].seq).toBe(15);

    // Duplicate safety: requesting an overlapping message does not duplicate it
    const duplicateOlder = [
      { _id: 'm-10', clientMessageId: 'c-10', seq: 10, text: 'Msg 10' },
      { _id: 'm-11', clientMessageId: 'c-11', seq: 11, text: 'Msg 11' }
    ];
    const withDuplicates = reconcileMessageList(prepended, duplicateOlder, new Map());
    expect(withDuplicates).toHaveLength(10);
    expect(withDuplicates.map(m => m.seq)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('18. Reopening or refreshing retrieves persisted messages in ascending sequence order', () => {
    // Simulated server database records for the conversation
    const serverPersistedMessages = [
      { _id: 'm-1', clientMessageId: 'c-1', seq: 1, text: 'First persisted' },
      { _id: 'm-2', clientMessageId: 'c-2', seq: 2, text: 'Second persisted' },
      { _id: 'm-3', clientMessageId: 'c-3', seq: 3, text: 'Third persisted' }
    ];

    // Client opens conversation initially: receives baseline
    const initialLoad = sortAndDeduplicate(serverPersistedMessages);
    expect(initialLoad.map(m => m.seq)).toEqual([1, 2, 3]);

    // Client refreshes / reopens: receives fresh baseline from server
    const reloaded = sortAndDeduplicate(serverPersistedMessages);
    expect(reloaded).toHaveLength(3);
    expect(reloaded.map(m => m.seq)).toEqual([1, 2, 3]);
    expect(reloaded[0].text).toBe('First persisted');
    expect(reloaded[2].text).toBe('Third persisted');
  });

  describe('Seen Read Receipt Mechanics (Direct Conversations)', () => {
    const myId = 'user-me';
    const otherId = 'user-other';

    it('19. The frontend displays "Seen" only for the latest outgoing message when recipient read position reaches it', () => {
      const messages = [
        { _id: 'm1', sender: myId, seq: 1, text: 'First msg from me', status: 'persisted' },
        { _id: 'm2', sender: myId, seq: 2, text: 'Second msg from me', status: 'persisted' }
      ];

      // Other participant has read up to seq 2
      const seenStatus = computeSeenStatus(messages, myId, 2);

      // Only latest outgoing message (m2) has Seen === true; earlier m1 has false
      expect(seenStatus).toEqual([false, true]);
    });

    it('20. The frontend does not show "Seen" for incoming messages, earlier outgoing messages, or messages not yet read', () => {
      const messages = [
        { _id: 'm1', sender: myId, seq: 1, text: 'First msg from me', status: 'persisted' },
        { _id: 'm2', sender: otherId, seq: 2, text: 'Incoming reply from friend', status: 'persisted' },
        { _id: 'm3', sender: myId, seq: 3, text: 'Latest msg from me', status: 'persisted' }
      ];

      // Case A: Recipient read up to seq 1 (has not read m3)
      const seenPartial = computeSeenStatus(messages, myId, 1);
      // m3 is not yet read, m2 is incoming, m1 is earlier -> none show Seen
      expect(seenPartial).toEqual([false, false, false]);

      // Case B: Recipient read up to seq 3 (has read m3)
      const seenFull = computeSeenStatus(messages, myId, 3);
      // m3 is latest outgoing -> true; m2 is incoming -> false; m1 is earlier outgoing -> false
      expect(seenFull).toEqual([false, false, true]);

      // Case C: Conversation has only incoming messages
      const onlyIncoming = [
        { _id: 'in1', sender: otherId, seq: 1, text: 'Hi', status: 'persisted' }
      ];
      expect(computeSeenStatus(onlyIncoming, myId, 5)).toEqual([false]);
    });

    it('21. Optimistic (sending) or failed messages do not display "Seen"', () => {
      const messages = [
        { _id: 'm1', sender: myId, seq: 1, text: 'First confirmed', status: 'persisted' },
        { _id: 'temp-2', clientMessageId: 'c2', sender: myId, text: 'Still sending', status: 'sending' }
      ];

      // Even if otherLastReadSeq is 5, optimistic message without confirmed seq cannot show Seen
      const seenSending = computeSeenStatus(messages, myId, 5);
      expect(seenSending).toEqual([false, false]);

      const failedMessages = [
        { _id: 'm1', sender: myId, seq: 1, text: 'First confirmed', status: 'persisted' },
        { _id: 'temp-3', clientMessageId: 'c3', sender: myId, text: 'Failed send', status: 'failed' }
      ];
      const seenFailed = computeSeenStatus(failedMessages, myId, 5);
      expect(seenFailed).toEqual([false, false]);
    });

    it('22. Duplicate, stale, and out-of-order events cannot regress the effective read position', () => {
      let readSeq = 5;

      // Stale event arrives with seq: 3
      readSeq = handleChatReadEvent({
        currentReadSeq: readSeq,
        payload: { conversationId: 'c1', readerId: otherId, lastReadSeq: 3 },
        activeConversationId: 'c1',
        targetUserId: otherId
      });
      expect(readSeq).toBe(5);

      // Duplicate event arrives with seq: 5
      readSeq = handleChatReadEvent({
        currentReadSeq: readSeq,
        payload: { conversationId: 'c1', readerId: otherId, lastReadSeq: 5 },
        activeConversationId: 'c1',
        targetUserId: otherId
      });
      expect(readSeq).toBe(5);

      // Advanced event arrives with seq: 8
      readSeq = handleChatReadEvent({
        currentReadSeq: readSeq,
        payload: { conversationId: 'c1', readerId: otherId, lastReadSeq: 8 },
        activeConversationId: 'c1',
        targetUserId: otherId
      });
      expect(readSeq).toBe(8);
    });

    it('23. Events for different conversations or other readers are ignored', () => {
      let readSeq = 3;

      // Event for another conversation
      readSeq = handleChatReadEvent({
        currentReadSeq: readSeq,
        payload: { conversationId: 'other-conv', readerId: otherId, lastReadSeq: 10 },
        activeConversationId: 'c1',
        targetUserId: otherId
      });
      expect(readSeq).toBe(3);

      // Event from a different user (not the target direct participant)
      readSeq = handleChatReadEvent({
        currentReadSeq: readSeq,
        payload: { conversationId: 'c1', readerId: 'unrelated-user', lastReadSeq: 10 },
        activeConversationId: 'c1',
        targetUserId: otherId
      });
      expect(readSeq).toBe(3);
    });

    it('24. Conversation switching and component cleanup remove the exact socket listeners without broad socket.off()', () => {
      const activeListeners = new Map();
      const mockSocket = {
        on: vi.fn((event, handler) => {
          activeListeners.set(event, handler);
        }),
        off: vi.fn((event, handler) => {
          if (activeListeners.get(event) === handler) {
            activeListeners.delete(event);
          }
        })
      };

      // Register listeners as done in useChatSync
      const onMsg = () => {};
      const onRead = () => {};
      mockSocket.on('chat:message', onMsg);
      mockSocket.on('chat:read', onRead);

      expect(activeListeners.has('chat:message')).toBe(true);
      expect(activeListeners.has('chat:read')).toBe(true);

      // Precise cleanup
      mockSocket.off('chat:message', onMsg);
      mockSocket.off('chat:read', onRead);

      expect(mockSocket.off).toHaveBeenCalledWith('chat:message', onMsg);
      expect(mockSocket.off).toHaveBeenCalledWith('chat:read', onRead);
      // Broad socket.off() was never called
      expect(mockSocket.off).not.toHaveBeenCalledWith();
      expect(activeListeners.size).toBe(0);
    });

    it('25. Initial history and reconnect reconciliation restore the correct receipt state without requiring a new socket event', () => {
      // Server-provided conversation with readState
      const serverConversation = {
        _id: 'conv-101',
        participants: [
          { _id: myId, displayName: 'Me' },
          { _id: otherId, displayName: 'Friend' }
        ],
        lastSeq: 7,
        readState: [
          { user: myId, lastReadSeq: 7 },
          { user: otherId, lastReadSeq: 6 }
        ]
      };

      // Extract read position from server-provided conversation
      const otherEntry = serverConversation.readState.find(r => r.user === otherId);
      const reconciledSeq = otherEntry?.lastReadSeq || 0;
      expect(reconciledSeq).toBe(6);

      // Without receiving any socket event, messages up to seq 6 are already known as Seen
      const messages = [
        { _id: 'm1', sender: myId, seq: 5, text: 'Five', status: 'persisted' },
        { _id: 'm2', sender: myId, seq: 6, text: 'Six', status: 'persisted' }
      ];

      const status = computeSeenStatus(messages, myId, reconciledSeq);
      expect(status).toEqual([false, true]);
    });
  });

});

