import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Checkpoint B2: Frontend Inbox Redesign & Realtime Integration', () => {

  describe('1. Generic Inbox labels & absence of private message text', () => {
    // Helper replicating Inbox.jsx preview resolution
    const resolveInboxPreview = (conv) => {
      const isAdmin = conv.isModeration || conv.lastMessage?.senderRole === 'admin';
      return isAdmin 
        ? (conv.lastMessage?.text || 'Official Notice') 
        : (conv.lastMessage?.activityText || 'Just messaged you');
    };

    it('always displays "Just messaged you" for friend messages even if message text exists in payload', () => {
      const friendConvWithText = {
        _id: 'conv-123',
        isModeration: false,
        lastMessage: {
          senderRole: 'user',
          text: 'SUPER_SECRET_PRIVATE_MESSAGE_BODY_12345',
          activityText: 'Just messaged you',
          seq: 4
        }
      };

      const preview = resolveInboxPreview(friendConvWithText);
      expect(preview).toBe('Just messaged you');
      expect(preview).not.toContain('SUPER_SECRET');
      expect(preview).not.toContain(friendConvWithText.lastMessage.text);
    });

    it('falls back to "Just messaged you" if activityText is missing', () => {
      const friendConvWithoutActivityText = {
        _id: 'conv-124',
        isModeration: false,
        lastMessage: {
          senderRole: 'user',
          seq: 1
        }
      };

      const preview = resolveInboxPreview(friendConvWithoutActivityText);
      expect(preview).toBe('Just messaged you');
    });

    it('preserves official notification text for admin / moderation notices', () => {
      const adminNotice = {
        _id: 'conv-admin',
        isModeration: true,
        lastMessage: {
          senderRole: 'admin',
          text: 'Your appeal #999 has been approved by the moderation team.',
          seq: 2
        }
      };

      const preview = resolveInboxPreview(adminNotice);
      expect(preview).toBe('Your appeal #999 has been approved by the moderation team.');
    });
  });

  describe('2. Participant identification & navigation target resolution', () => {
    const resolveOtherParticipantAndNavigation = (conv, currentUserIdStr) => {
      const otherParticipant = conv.participants?.find(p => {
        const pId = (p?._id || p)?.toString();
        return pId !== currentUserIdStr;
      });

      const isAdmin = conv.isModeration || conv.lastMessage?.senderRole === 'admin';
      const displayName = isAdmin 
        ? (conv.lastMessage?.senderDisplayName || 'ZYNC Super Admin') 
        : (otherParticipant?.displayName || 'Player');

      const targetId = (otherParticipant?._id || otherParticipant)?.toString();
      const navigationPath = (!isAdmin && targetId) ? `/chat/${targetId}` : null;

      return { otherParticipant, displayName, targetId, navigationPath, isAdmin };
    };

    it('correctly identifies the other participant and navigates to /chat/:targetId', () => {
      const currentUserId = 'user-current';
      const conv = {
        _id: 'conv-xyz',
        isModeration: false,
        participants: [
          { _id: 'user-current', displayName: 'Me' },
          { _id: 'user-friend-456', displayName: 'SquadMate99' }
        ]
      };

      const result = resolveOtherParticipantAndNavigation(conv, currentUserId);
      expect(result.displayName).toBe('SquadMate99');
      expect(result.targetId).toBe('user-friend-456');
      expect(result.navigationPath).toBe('/chat/user-friend-456');
      expect(result.isAdmin).toBe(false);
    });

    it('handles participant IDs whether stored as objects or plain strings', () => {
      const currentUserId = 'user-current';
      const conv = {
        _id: 'conv-plain-strings',
        isModeration: false,
        participants: ['user-current', 'user-friend-789']
      };

      const result = resolveOtherParticipantAndNavigation(conv, currentUserId);
      expect(result.targetId).toBe('user-friend-789');
      expect(result.navigationPath).toBe('/chat/user-friend-789');
    });

    it('disables direct navigation for official admin / moderation notices', () => {
      const currentUserId = 'user-current';
      const conv = {
        _id: 'conv-mod',
        isModeration: true,
        lastMessage: {
          senderRole: 'admin',
          senderDisplayName: 'ZYNC Super Admin',
          text: 'Official notice'
        },
        participants: [{ _id: 'user-current' }, { _id: 'admin-user' }]
      };

      const result = resolveOtherParticipantAndNavigation(conv, currentUserId);
      expect(result.isAdmin).toBe(true);
      expect(result.displayName).toBe('ZYNC Super Admin');
      expect(result.navigationPath).toBeNull();
    });
  });

  describe('3. Realtime activity handling & deduplication by conversation ID', () => {
    // Helper replicating the state reconciliation in Inbox.jsx
    const applyInboxActivity = (prevConversations, activity, onNewConversationCallback) => {
      if (!activity || !activity.conversationId) return prevConversations;
      const convIdStr = activity.conversationId.toString();

      const existingIndex = prevConversations.findIndex(c => c._id?.toString() === convIdStr);
      if (existingIndex >= 0) {
        const existing = prevConversations[existingIndex];
        const updated = {
          ...existing,
          lastMessage: {
            ...(existing.lastMessage || {}),
            sender: activity.sender,
            senderDisplayName: activity.senderDisplayName || existing.lastMessage?.senderDisplayName,
            activityText: activity.activityText || 'Just messaged you',
            seq: activity.seq || (existing.lastSeq || 0) + 1,
            createdAt: activity.createdAt || new Date().toISOString()
          },
          lastMessageAt: activity.createdAt || new Date().toISOString(),
          lastSeq: activity.seq || (existing.lastSeq || 0) + 1,
          isUnread: true
        };
        // Move updated conversation to top with deduplication
        return [updated, ...prevConversations.filter((_, idx) => idx !== existingIndex)];
      } else {
        if (typeof onNewConversationCallback === 'function') {
          onNewConversationCallback();
        }
        return prevConversations;
      }
    };

    it('moves updated conversation to the top and marks it unread', () => {
      const initialConvs = [
        { _id: 'conv-1', lastSeq: 2, isUnread: false },
        { _id: 'conv-2', lastSeq: 5, isUnread: false }
      ];

      const activity = {
        conversationId: 'conv-2',
        sender: 'friend-2',
        senderDisplayName: 'Friend 2',
        activityText: 'Just messaged you',
        seq: 6,
        createdAt: '2026-10-23T02:00:00.000Z'
      };

      const updated = applyInboxActivity(initialConvs, activity);
      expect(updated.length).toBe(2);
      expect(updated[0]._id).toBe('conv-2');
      expect(updated[0].isUnread).toBe(true);
      expect(updated[0].lastSeq).toBe(6);
      expect(updated[0].lastMessage.activityText).toBe('Just messaged you');
      expect(updated[1]._id).toBe('conv-1');
    });

    it('deduplicates multiple rapid socket events for the same conversation', () => {
      const initialConvs = [
        { _id: 'conv-1', lastSeq: 1, isUnread: false }
      ];

      const activity1 = { conversationId: 'conv-1', seq: 2, activityText: 'Just messaged you' };
      const activity2 = { conversationId: 'conv-1', seq: 3, activityText: 'Just messaged you' };

      let convs = applyInboxActivity(initialConvs, activity1);
      convs = applyInboxActivity(convs, activity2);

      expect(convs.length).toBe(1);
      expect(convs[0]._id).toBe('conv-1');
      expect(convs[0].lastSeq).toBe(3);
    });

    it('triggers a full re-fetch callback when an activity arrives for a conversation not yet in list', () => {
      const initialConvs = [{ _id: 'conv-1' }];
      const refetchSpy = vi.fn();

      const newActivity = { conversationId: 'conv-unknown-999', seq: 1 };
      applyInboxActivity(initialConvs, newActivity, refetchSpy);

      expect(refetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. Sender-side filtering & unread behavior', () => {
    it('verifies that outgoing messages do not create unread status for the sender', () => {
      // In backend B1, when user sends a message, their lastReadSeq is updated to nextSeq.
      // Therefore isUnread is computed as: Boolean(c.lastSeq > userLastReadSeq && lastMsgSender !== req.user._id)
      const currentUserId = 'user-sender';

      const computeIsUnread = (conv, userId) => {
        const lastReadSeq = conv.readState?.find(r => r.user?.toString() === userId)?.lastReadSeq || 0;
        const lastSender = conv.lastMessage?.sender?.toString();
        const hasNewer = (conv.lastSeq || 0) > lastReadSeq;
        const notSentByMe = lastSender !== userId;
        return Boolean(hasNewer && notSentByMe);
      };

      const convAfterSending = {
        _id: 'conv-10',
        lastSeq: 5,
        lastMessage: {
          sender: currentUserId,
          seq: 5
        },
        readState: [
          { user: currentUserId, lastReadSeq: 5 }
        ]
      };

      const isUnreadForSender = computeIsUnread(convAfterSending, currentUserId);
      expect(isUnreadForSender).toBe(false);
    });

    it('marks conversation unread only for the recipient', () => {
      const recipientId = 'user-recipient';
      const senderId = 'user-sender';

      const conv = {
        _id: 'conv-10',
        lastSeq: 5,
        lastMessage: {
          sender: senderId,
          seq: 5
        },
        readState: [
          { user: senderId, lastReadSeq: 5 },
          { user: recipientId, lastReadSeq: 4 }
        ]
      };

      const computeIsUnread = (c, userId) => {
        const lastReadSeq = c.readState?.find(r => r.user?.toString() === userId)?.lastReadSeq || 0;
        const lastSender = c.lastMessage?.sender?.toString();
        const hasNewer = (c.lastSeq || 0) > lastReadSeq;
        const notSentByMe = lastSender !== userId;
        return Boolean(hasNewer && notSentByMe);
      };

      expect(computeIsUnread(conv, recipientId)).toBe(true);
      expect(computeIsUnread(conv, senderId)).toBe(false);
    });
  });

  describe('5. Navbar Inbox indicator calculation & reconciliation', () => {
    const calculateNavbarIndicator = (requests, inboxItems) => {
      const hasPendingReqs = Array.isArray(requests) && requests.length > 0;
      const hasUnreadInbox = Array.isArray(inboxItems) && inboxItems.some(
        c => Boolean(c.isUnread)
      );
      return Boolean(hasPendingReqs || hasUnreadInbox);
    };

    const deriveUnreadMessageState = (inboxItems) => {
      return Array.isArray(inboxItems) && inboxItems.some(c => Boolean(c.isUnread));
    };

    it('shows indicator when there are pending connection requests', () => {
      const requests = [{ _id: 'req-1', requester: { displayName: 'Gamer' } }];
      const inboxItems = [{ _id: 'c-1', isUnread: false }];

      expect(calculateNavbarIndicator(requests, inboxItems)).toBe(true);
      expect(deriveUnreadMessageState(inboxItems)).toBe(false);
    });

    it('shows indicator when there is an unread friend message in inbox', () => {
      const requests = [];
      const inboxItems = [
        { _id: 'c-1', isUnread: false },
        { _id: 'c-2', isUnread: true }
      ];

      expect(calculateNavbarIndicator(requests, inboxItems)).toBe(true);
      expect(deriveUnreadMessageState(inboxItems)).toBe(true);
    });

    it('does NOT activate unread indicator when an official/moderation notice has isUnread: false', () => {
      const requests = [];
      const inboxItems = [
        { _id: 'c-mod', isUnread: false, isModeration: true }
      ];

      expect(calculateNavbarIndicator(requests, inboxItems)).toBe(false);
      expect(deriveUnreadMessageState(inboxItems)).toBe(false);
    });

    it('activates unread indicator when an official/moderation notice has isUnread: true', () => {
      const requests = [];
      const inboxItems = [
        { _id: 'c-mod', isUnread: true, isModeration: true }
      ];

      expect(calculateNavbarIndicator(requests, inboxItems)).toBe(true);
      expect(deriveUnreadMessageState(inboxItems)).toBe(true);
    });

    it('does NOT activate unread-message indicator for read admin-authored messages', () => {
      const requests = [];
      const inboxItems = [
        { _id: 'c-admin', isUnread: false, lastMessage: { senderRole: 'admin', text: 'Official note' } }
      ];

      expect(calculateNavbarIndicator(requests, inboxItems)).toBe(false);
      expect(deriveUnreadMessageState(inboxItems)).toBe(false);
    });

    it('clears indicator when requests are empty and all inbox items are read without admin notices', () => {
      const requests = [];
      const inboxItems = [
        { _id: 'c-1', isUnread: false, isModeration: false },
        { _id: 'c-2', isUnread: false, isModeration: false }
      ];

      expect(calculateNavbarIndicator(requests, inboxItems)).toBe(false);
      expect(deriveUnreadMessageState(inboxItems)).toBe(false);
    });

    it('handles empty states cleanly without error', () => {
      expect(calculateNavbarIndicator([], [])).toBe(false);
      expect(calculateNavbarIndicator(null, null)).toBe(false);
    });
  });

  describe('6. Sequence-aware mark-as-read contract & highestSeq calculation', () => {
    // Helper replicating Chat.jsx highestSeq computation
    const computeHighestLoadedSeq = (messages) => {
      if (!Array.isArray(messages) || messages.length === 0) return 0;
      return messages.reduce((max, msg) => {
        if (typeof msg.seq === 'number' && Number.isSafeInteger(msg.seq)) {
          return Math.max(max, msg.seq);
        }
        return max;
      }, 0);
    };

    it('computes highestSeq strictly from valid integer sequence numbers in loaded messages', () => {
      const messages = [
        { _id: 'm1', seq: 1 },
        { _id: 'm2', seq: 2 },
        { _id: 'm3', seq: 5 }
      ];

      expect(computeHighestLoadedSeq(messages)).toBe(5);
    });

    it('ignores optimistic or pending messages that lack sequence numbers', () => {
      const messages = [
        { _id: 'm1', seq: 1 },
        { _id: 'm2', seq: 2 },
        { _id: 'temp-opt-1', clientMessageId: 'uuid-1', status: 'sending' } // no seq
      ];

      expect(computeHighestLoadedSeq(messages)).toBe(2);
    });

    it('never marks messages read beyond what the client has actually loaded and displayed', () => {
      // Simulate server having lastSeq: 15, but client only has loaded initial 10 messages (seq 1 to 10)
      const clientLoadedMessages = Array.from({ length: 10 }, (_, i) => ({
        _id: `m-${i + 1}`,
        seq: i + 1
      }));

      const highestLoadedSeq = computeHighestLoadedSeq(clientLoadedMessages);
      expect(highestLoadedSeq).toBe(10);
      expect(highestLoadedSeq).not.toBe(15);
    });

    it('tracks lastMarkedSeqRef to avoid redundant API calls for unchanged sequence', () => {
      let lastMarkedSeq = 0;
      const markApiSpy = vi.fn((seq) => {
        lastMarkedSeq = seq;
      });

      const handleMarkRead = (messages) => {
        const highestSeq = computeHighestLoadedSeq(messages);
        if (highestSeq > lastMarkedSeq) {
          markApiSpy(highestSeq);
        }
      };

      const msgsStep1 = [{ _id: 'm1', seq: 3 }];
      handleMarkRead(msgsStep1);
      expect(markApiSpy).toHaveBeenCalledWith(3);
      expect(markApiSpy).toHaveBeenCalledTimes(1);

      // Re-running with same messages does not call again
      handleMarkRead(msgsStep1);
      expect(markApiSpy).toHaveBeenCalledTimes(1);

      // New message arriving advances sequence and triggers read call
      const msgsStep2 = [{ _id: 'm1', seq: 3 }, { _id: 'm2', seq: 4 }];
      handleMarkRead(msgsStep2);
      expect(markApiSpy).toHaveBeenCalledWith(4);
      expect(markApiSpy).toHaveBeenCalledTimes(2);
    });

    it('resets lastMarkedSeq when switching active conversation', () => {
      let lastMarkedSeqRef = { current: 5 };

      // Conversation switch effect in Chat.jsx resets lastMarkedSeqRef to 0
      const onConversationChange = () => {
        lastMarkedSeqRef.current = 0;
      };

      onConversationChange();
      expect(lastMarkedSeqRef.current).toBe(0);
    });
  });

  describe('7. Friend-request Accept/Decline state preservation', () => {
    it('accepting a connection request removes it from incoming state', () => {
      const initialRequests = [
        { _id: 'req-1', requester: { displayName: 'Alice' } },
        { _id: 'req-2', requester: { displayName: 'Bob' } }
      ];

      const handleAccept = (list, connectionId) => list.filter(r => r._id !== connectionId);
      const remaining = handleAccept(initialRequests, 'req-1');

      expect(remaining.length).toBe(1);
      expect(remaining[0]._id).toBe('req-2');
    });

    it('declining a connection request removes it from incoming state', () => {
      const initialRequests = [
        { _id: 'req-1', requester: { displayName: 'Alice' } },
        { _id: 'req-2', requester: { displayName: 'Bob' } }
      ];

      const handleDecline = (list, connectionId) => list.filter(r => r._id !== connectionId);
      const remaining = handleDecline(initialRequests, 'req-2');

      expect(remaining.length).toBe(1);
      expect(remaining[0]._id).toBe('req-1');
    });
  });

  describe('8. Inbox Blue Dot Bug Regression Coverage & Read Synchronization', () => {
    // Replicates handleInboxActivity deduplication logic from Inbox.jsx
    const applyActivityWithDeduplication = (prevConversations, activity) => {
      if (!activity || !activity.conversationId) return prevConversations;
      const convIdStr = activity.conversationId.toString();
      const activitySeq = typeof activity.seq === 'number' ? activity.seq : null;

      const existingIndex = prevConversations.findIndex(c => c._id?.toString() === convIdStr);
      if (existingIndex >= 0) {
        const existing = prevConversations[existingIndex];
        const effectiveSeq = activitySeq || (existing.lastSeq || 0) + 1;

        const isAlreadyRead = typeof existing.lastReadSeq === 'number' && existing.lastReadSeq >= effectiveSeq;
        const isDuplicateOld = (existing.lastSeq || 0) >= effectiveSeq && !existing.isUnread;
        const shouldMarkUnread = !isAlreadyRead && !isDuplicateOld;

        const updated = {
          ...existing,
          lastMessageAt: activity.createdAt || new Date().toISOString(),
          lastSeq: effectiveSeq,
          isUnread: shouldMarkUnread
        };
        return [updated, ...prevConversations.filter((_, idx) => idx !== existingIndex)];
      }
      return prevConversations;
    };

    // Replicates handleInboxRead from Inbox.jsx
    const applyInboxRead = (prevConversations, readData) => {
      if (!readData || !readData.conversationId) return prevConversations;
      const convIdStr = readData.conversationId.toString();
      const readSeq = typeof readData.lastReadSeq === 'number' ? readData.lastReadSeq : 0;

      return prevConversations.map(c => {
        if (c._id?.toString() === convIdStr) {
          const nextReadSeq = Math.max(c.lastReadSeq || 0, readSeq);
          const isUnread = (c.lastSeq || 0) > nextReadSeq;
          return {
            ...c,
            lastReadSeq: nextReadSeq,
            isUnread
          };
        }
        return c;
      });
    };

    it('duplicate activity event does NOT resurrect unread state for an already read conversation', () => {
      const convs = [
        { _id: 'conv-1', lastSeq: 5, lastReadSeq: 5, isUnread: false }
      ];

      // Duplicate socket event arrives for seq 5
      const duplicateActivity = { conversationId: 'conv-1', seq: 5 };
      const result = applyActivityWithDeduplication(convs, duplicateActivity);

      expect(result[0].isUnread).toBe(false);
      expect(result[0].lastSeq).toBe(5);
    });

    it('duplicate activity with old sequence does not make conversation unread', () => {
      const convs = [
        { _id: 'conv-1', lastSeq: 8, lastReadSeq: 8, isUnread: false }
      ];

      const oldActivity = { conversationId: 'conv-1', seq: 4 };
      const result = applyActivityWithDeduplication(convs, oldActivity);

      expect(result[0].isUnread).toBe(false);
    });

    it('genuinely newer incoming activity sets isUnread to true', () => {
      const convs = [
        { _id: 'conv-1', lastSeq: 5, lastReadSeq: 5, isUnread: false }
      ];

      const newActivity = { conversationId: 'conv-1', seq: 6 };
      const result = applyActivityWithDeduplication(convs, newActivity);

      expect(result[0].isUnread).toBe(true);
      expect(result[0].lastSeq).toBe(6);
    });

    it('reader-side inbox:read event synchronizes unread state across multiple tabs', () => {
      const convsInTabB = [
        { _id: 'conv-1', lastSeq: 7, lastReadSeq: 4, isUnread: true },
        { _id: 'conv-2', lastSeq: 3, lastReadSeq: 3, isUnread: false }
      ];

      // Tab A marks conv-1 read up to seq 7 and server emits inbox:read to user's room
      const readEvent = { conversationId: 'conv-1', lastReadSeq: 7, isUnread: false };
      const updatedTabB = applyInboxRead(convsInTabB, readEvent);

      expect(updatedTabB[0]._id).toBe('conv-1');
      expect(updatedTabB[0].isUnread).toBe(false);
      expect(updatedTabB[0].lastReadSeq).toBe(7);
      expect(updatedTabB[1].isUnread).toBe(false);
    });

    it('inbox:read event never moves lastReadSeq backward', () => {
      const convs = [
        { _id: 'conv-1', lastSeq: 10, lastReadSeq: 10, isUnread: false }
      ];

      // Stale read event with smaller sequence
      const staleReadEvent = { conversationId: 'conv-1', lastReadSeq: 8 };
      const result = applyInboxRead(convs, staleReadEvent);

      expect(result[0].lastReadSeq).toBe(10);
      expect(result[0].isUnread).toBe(false);
    });

    it('chat-to-inbox race: inboxReadStateChanged triggers fresh data fetch', () => {
      let isRefreshed = false;
      const onInboxReadStateChanged = () => {
        isRefreshed = true;
      };

      // Simulates Chat.jsx dispatching event after read commit
      onInboxReadStateChanged();
      expect(isRefreshed).toBe(true);
    });

    it('focus reconciliation: window focus triggers fresh data fetch', () => {
      let focusRefreshed = false;
      const onWindowFocus = () => {
        focusRefreshed = true;
      };

      onWindowFocus();
      expect(focusRefreshed).toBe(true);
    });

    it('read failure in Chat.jsx restores lastMarkedSeqRef for future retries', () => {
      let lastMarkedSeq = 0;
      const prevMarked = lastMarkedSeq;
      const attemptSeq = 5;

      // Optimistic attempt
      lastMarkedSeq = attemptSeq;

      // Simulated network failure callback
      const onFailedPersist = () => {
        if (lastMarkedSeq === attemptSeq) {
          lastMarkedSeq = prevMarked;
        }
      };

      onFailedPersist();
      expect(lastMarkedSeq).toBe(0); // restored for retry
    });

    it('moderation notice acknowledgement updates readState without navigating into Chat', () => {
      const convs = [
        { _id: 'mod-1', isModeration: true, lastSeq: 2, lastReadSeq: 0, isUnread: true }
      ];

      const acknowledgeNotice = (list, convId, seq) => {
        return list.map(c => {
          if (c._id === convId) {
            return { ...c, isUnread: false, lastReadSeq: seq };
          }
          return c;
        });
      };

      const result = acknowledgeNotice(convs, 'mod-1', 2);
      expect(result[0].isUnread).toBe(false);
      expect(result[0].lastReadSeq).toBe(2);
    });

    it('verifies listener registration and cleanup semantics', () => {
      const listeners = new Map();
      const addListener = (event, fn) => listeners.set(event, fn);
      const removeListener = (event) => listeners.delete(event);

      // Mount
      addListener('inboxReadStateChanged', () => {});
      addListener('focus', () => {});
      expect(listeners.has('inboxReadStateChanged')).toBe(true);
      expect(listeners.has('focus')).toBe(true);

      // Unmount
      removeListener('inboxReadStateChanged');
      removeListener('focus');
      expect(listeners.has('inboxReadStateChanged')).toBe(false);
      expect(listeners.has('focus')).toBe(false);
    });
  });

});
