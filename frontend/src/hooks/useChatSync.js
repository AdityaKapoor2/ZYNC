import { useState, useEffect, useRef, useCallback } from 'react';
import { getMessages, sendMessage as apiSendMessage } from '../services/api';

/**
 * Standard RFC 4122 v4 UUID generator.
 */
export const generateUUIDv4 = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Normalizes an ID value (string, ObjectId-like object with toString() or hex string)
 * to a canonical string. Returns empty string if invalid or missing.
 */
export const normalizeConversationId = (val) => {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object' && val !== null) {
    if (typeof val.toHexString === 'function') return val.toHexString();
    if (typeof val.toString === 'function') return val.toString().trim();
    const extracted = val._id || val.id;
    if (extracted && extracted !== val) return normalizeConversationId(extracted);
  }
  return String(val).trim();
};

/**
 * Sorts messages ascending by seq (or createdAt for unsequenced/optimistic messages)
 * and deduplicates strictly by _id, clientMessageId, and seq.
 */
export const sortAndDeduplicate = (messages) => {
  if (!Array.isArray(messages)) return [];

  const seenIds = new Set();
  const seenClientIds = new Set();
  const seenSeqs = new Set();
  const deduplicated = [];

  // When deduplicating, prioritize messages with confirmed seq over unconfirmed/optimistic duplicates
  const prioritized = [...messages].sort((a, b) => {
    const aHasSeq = typeof a?.seq === 'number' && a.seq > 0;
    const bHasSeq = typeof b?.seq === 'number' && b.seq > 0;
    if (aHasSeq && !bHasSeq) return -1;
    if (!aHasSeq && bHasSeq) return 1;
    return 0;
  });

  for (const msg of prioritized) {
    if (!msg) continue;

    // Check duplicate by _id
    if (msg._id && seenIds.has(String(msg._id))) continue;
    // Check duplicate by clientMessageId
    if (msg.clientMessageId && seenClientIds.has(msg.clientMessageId)) continue;
    // Check duplicate by seq (only for committed messages with valid seq > 0)
    if (typeof msg.seq === 'number' && msg.seq > 0 && seenSeqs.has(msg.seq)) continue;

    if (msg._id) seenIds.add(String(msg._id));
    if (msg.clientMessageId) seenClientIds.add(msg.clientMessageId);
    if (typeof msg.seq === 'number' && msg.seq > 0) seenSeqs.add(msg.seq);

    deduplicated.push(msg);
  }

  return deduplicated.sort((a, b) => {
    const aSeq = typeof a?.seq === 'number' && a.seq > 0 ? a.seq : null;
    const bSeq = typeof b?.seq === 'number' && b.seq > 0 ? b.seq : null;

    // Both have valid sequences: strict canonical sequence ordering (lowest seq at top, highest seq at bottom)
    if (aSeq !== null && bSeq !== null) {
      return aSeq - bSeq;
    }
    // Confirmed sequenced messages always precede unconfirmed optimistic messages
    if (aSeq !== null) return -1;
    if (bSeq !== null) return 1;

    // Unsequenced optimistic/pending messages appear at bottom in order of creation
    const timeA = new Date(a.createdAt || 0).getTime();
    const timeB = new Date(b.createdAt || 0).getTime();
    return timeA - timeB;
  });
};

/**
 * Reconciles an incoming list of messages into the existing list,
 * matching and resolving optimistic messages by clientMessageId.
 */
export const reconcileMessageList = (currentMessages, incomingMessages, optimisticMap) => {
  const current = Array.isArray(currentMessages) ? currentMessages : [];
  const incoming = Array.isArray(incomingMessages) ? incomingMessages : [incomingMessages];

  const existingByClientId = new Map();
  const existingById = new Map();
  const existingBySeq = new Map();

  for (const m of current) {
    if (m.clientMessageId) existingByClientId.set(m.clientMessageId, m);
    if (m._id) existingById.set(String(m._id), m);
    if (typeof m.seq === 'number' && m.seq > 0) existingBySeq.set(m.seq, m);
  }

  const merged = [...current];

  for (const inc of incoming) {
    if (!inc) continue;

    // Reconcile matching optimistic message
    if (inc.clientMessageId && optimisticMap && optimisticMap.has(inc.clientMessageId)) {
      optimisticMap.delete(inc.clientMessageId);
    }

    let existingIndex = -1;
    if (inc.clientMessageId && existingByClientId.has(inc.clientMessageId)) {
      existingIndex = merged.findIndex(m => m.clientMessageId === inc.clientMessageId);
    } else if (inc._id && existingById.has(String(inc._id))) {
      existingIndex = merged.findIndex(m => String(m._id) === String(inc._id));
    } else if (typeof inc.seq === 'number' && inc.seq > 0 && existingBySeq.has(inc.seq)) {
      existingIndex = merged.findIndex(m => m.seq === inc.seq);
    }

    if (existingIndex !== -1) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...inc,
        status: inc.status || 'persisted'
      };
    } else {
      merged.push({
        ...inc,
        status: inc.status || 'persisted'
      });
    }

    if (inc.clientMessageId) existingByClientId.set(inc.clientMessageId, inc);
    if (inc._id) existingById.set(String(inc._id), inc);
    if (typeof inc.seq === 'number' && inc.seq > 0) existingBySeq.set(inc.seq, inc);
  }

  return sortAndDeduplicate(merged);
};

/**
 * Processes a chat:read socket event monotonically for a given active conversation.
 * Returns the new otherLastReadSeq if updated, or the previous value if ignored/stale.
 */
export const handleChatReadEvent = ({
  currentReadSeq = 0,
  payload,
  activeConversationId,
  targetUserId
}) => {
  if (!payload) return currentReadSeq;
  const incomingConvId = normalizeConversationId(payload.conversationId);
  const activeConvId = normalizeConversationId(activeConversationId);
  if (!incomingConvId || !activeConvId || incomingConvId !== activeConvId) {
    return currentReadSeq;
  }

  if (targetUserId) {
    const readerId = normalizeConversationId(payload.readerId);
    const targetId = normalizeConversationId(targetUserId);
    if (readerId && targetId && readerId !== targetId) {
      return currentReadSeq;
    }
  }

  const readSeq = Number(payload.lastReadSeq);
  if (typeof readSeq === 'number' && Number.isSafeInteger(readSeq) && readSeq > 0) {
    return Math.max(currentReadSeq || 0, readSeq);
  }
  return currentReadSeq;
};

/**
 * Custom React hook for sequence-based real-time chat synchronization.
 */
export const useChatSync = ({ conversationId, currentUser, targetUserId, socket, isConnected }) => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState('syncing'); // 'syncing' | 'synced' | 'reconnecting' | 'degraded'
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [syncError, setSyncError] = useState(null);
  const [otherLastReadSeq, setOtherLastReadSeq] = useState(0);

  // Synchronization refs (always synchronous, avoids stale closures in socket events)
  const highestContiguousSeqRef = useRef(0);
  const lowestLoadedSeqRef = useRef(Infinity);
  const serverLastSeqRef = useRef(0);
  const isInitialLoadingRef = useRef(true);
  const initialBufferRef = useRef([]);
  const outOfOrderBufferRef = useRef([]);
  const optimisticMapRef = useRef(new Map());
  const isRecoveringRef = useRef(false);
  const activeConvIdRef = useRef(conversationId);
  const hasLoadedBaselineRef = useRef(false);


  // Trigger gap recovery via afterSeq
  const triggerRecovery = useCallback(async () => {
    if (isRecoveringRef.current || isInitialLoadingRef.current) return;
    if (!conversationId || !currentUser) return;

    isRecoveringRef.current = true;
    setSyncStatus('syncing');
    const convId = activeConvIdRef.current;

    try {
      let cycles = 0;
      const MAX_CYCLES = 5;

      while (cycles < MAX_CYCLES) {
        if (activeConvIdRef.current !== convId) break;
        cycles++;

        const token = await currentUser.getIdToken();
        const afterSeq = highestContiguousSeqRef.current;

        const data = await getMessages(token, convId, { afterSeq, limit: 100 });
        if (activeConvIdRef.current !== convId) break;

        // Handle reset: true (server horizon invalidated or cleared)
        if (data.reset === true) {
          const resetMessages = (data.messages || []).map(m => ({ ...m, status: 'persisted' }));
          const sorted = sortAndDeduplicate(resetMessages);

          let rHighest = 0;
          let rLowest = Infinity;
          for (const m of sorted) {
            if (typeof m.seq === 'number' && m.seq > 0) {
              if (m.seq > rHighest) rHighest = m.seq;
              if (m.seq < rLowest) rLowest = m.seq;
            }
          }
          highestContiguousSeqRef.current = rHighest;
          lowestLoadedSeqRef.current = rLowest === Infinity ? 0 : rLowest;
          serverLastSeqRef.current = data.lastSeq || 0;

          // Reconcile buffered out-of-order messages against new baseline
          const buffered = [...outOfOrderBufferRef.current];
          outOfOrderBufferRef.current = [];

          const merged = reconcileMessageList(sorted, buffered, optimisticMapRef.current);
          setMessages(merged);

          if (highestContiguousSeqRef.current >= serverLastSeqRef.current) {
            setSyncStatus('synced');
            break;
          }
          continue;
        }

        const fetchedMessages = (data.messages || []).map(m => ({ ...m, status: 'persisted' }));
        const serverLast = typeof data.lastSeq === 'number' ? data.lastSeq : serverLastSeqRef.current;
        serverLastSeqRef.current = Math.max(serverLastSeqRef.current, serverLast);

        if (fetchedMessages.length > 0) {
          setMessages(prev => reconcileMessageList(prev, fetchedMessages, optimisticMapRef.current));

          for (const m of fetchedMessages) {
            if (typeof m.seq === 'number' && m.seq === highestContiguousSeqRef.current + 1) {
              highestContiguousSeqRef.current = m.seq;
            }
          }
        }

        // Check if out-of-order buffer can now be drained
        outOfOrderBufferRef.current.sort((a, b) => a.seq - b.seq);
        const chained = [];
        while (outOfOrderBufferRef.current.length > 0) {
          const head = outOfOrderBufferRef.current[0];
          if (head.seq === highestContiguousSeqRef.current + 1) {
            outOfOrderBufferRef.current.shift();
            highestContiguousSeqRef.current = head.seq;
            chained.push(head);
          } else if (head.seq <= highestContiguousSeqRef.current) {
            outOfOrderBufferRef.current.shift();
          } else {
            break;
          }
        }

        if (chained.length > 0) {
          setMessages(prev => reconcileMessageList(prev, chained, optimisticMapRef.current));
        }

        const hasMoreToFetch = Boolean(data.hasMore) || (highestContiguousSeqRef.current < serverLastSeqRef.current);
        if (!hasMoreToFetch && outOfOrderBufferRef.current.length === 0) {
          setSyncStatus('synced');
          break;
        }
      }

      if (cycles >= MAX_CYCLES && (highestContiguousSeqRef.current < serverLastSeqRef.current || outOfOrderBufferRef.current.length > 0)) {
        setSyncStatus('degraded');
      }
    } catch (err) {
      console.error('Error during chat recovery:', err);
      setSyncStatus('degraded');
      setSyncError(err.message || 'Recovery failed');
    } finally {
      isRecoveringRef.current = false;
    }
  }, [conversationId, currentUser]);

  // Handle incoming live message event
  const handleIncomingLiveMessage = useCallback((msg) => {
    if (msg.clientMessageId && optimisticMapRef.current.has(msg.clientMessageId)) {
      optimisticMapRef.current.delete(msg.clientMessageId);
    }

    const seq = msg.seq;

    // Unsequenced or already confirmed sequence: reconcile in-place or drop duplicate
    if (typeof seq !== 'number' || seq <= 0 || seq <= highestContiguousSeqRef.current) {
      setMessages(prev => reconcileMessageList(prev, [msg], optimisticMapRef.current));
      return;
    }

    // Exactly next sequence: contiguous!
    if (seq === highestContiguousSeqRef.current + 1) {
      highestContiguousSeqRef.current = seq;
      if (seq > serverLastSeqRef.current) {
        serverLastSeqRef.current = seq;
      }

      const chainedMessages = [msg];
      outOfOrderBufferRef.current.sort((a, b) => a.seq - b.seq);

      while (outOfOrderBufferRef.current.length > 0) {
        const nextExpected = highestContiguousSeqRef.current + 1;
        const head = outOfOrderBufferRef.current[0];
        if (head.seq === nextExpected) {
          outOfOrderBufferRef.current.shift();
          highestContiguousSeqRef.current = head.seq;
          chainedMessages.push(head);
        } else if (head.seq <= highestContiguousSeqRef.current) {
          outOfOrderBufferRef.current.shift();
        } else {
          break;
        }
      }

      setMessages(prev => reconcileMessageList(prev, chainedMessages, optimisticMapRef.current));

      if (outOfOrderBufferRef.current.length > 0) {
        triggerRecovery();
      } else {
        setSyncStatus('synced');
      }
      return;
    }

    // Gap detected! (seq > highestContiguousSeqRef.current + 1)
    // NEVER advance contiguous frontier across a sequence gap!
    outOfOrderBufferRef.current.push(msg);
    triggerRecovery();
  }, [triggerRecovery]);

  // Load baseline chat history
  const loadBaseline = useCallback(async (convId) => {
    if (!convId || !currentUser) return;

    try {
      const token = await currentUser.getIdToken();
      if (activeConvIdRef.current !== convId) return;

      const data = await getMessages(token, convId, { limit: 50 });
      if (activeConvIdRef.current !== convId) return;

      const rawMsgs = Array.isArray(data) ? data : (data.messages || []);
      const serverLast = typeof data.lastSeq === 'number' ? data.lastSeq : 0;
      const hasMore = Boolean(data.hasMore);

      serverLastSeqRef.current = serverLast;
      setHasMoreOlder(hasMore);

      const sortedBaseline = sortAndDeduplicate(rawMsgs.map(m => ({ ...m, status: 'persisted' })));

      let baseHighest = 0;
      let baseLowest = Infinity;

      for (const m of sortedBaseline) {
        if (typeof m.seq === 'number' && m.seq > 0) {
          if (m.seq > baseHighest) baseHighest = m.seq;
          if (m.seq < baseLowest) baseLowest = m.seq;
        }
      }

      highestContiguousSeqRef.current = baseHighest;
      lowestLoadedSeqRef.current = baseLowest === Infinity ? 0 : baseLowest;
      hasLoadedBaselineRef.current = true;

      // End initial loading gate
      isInitialLoadingRef.current = false;

      // Drain events that arrived while initial request was in-flight
      const buffered = [...initialBufferRef.current];
      initialBufferRef.current = [];

      // Separate contiguous buffered events from out-of-order gap events
      buffered.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      const contiguousBuffered = [];
      let nextContiguous = baseHighest;

      for (const b of buffered) {
        if (typeof b.seq === 'number' && b.seq > 0) {
          if (b.seq <= nextContiguous) {
            contiguousBuffered.push(b);
          } else if (b.seq === nextContiguous + 1) {
            nextContiguous = b.seq;
            contiguousBuffered.push(b);
          } else {
            // Gap detected: hold in out-of-order buffer
            outOfOrderBufferRef.current.push(b);
          }
        } else {
          contiguousBuffered.push(b);
        }
      }

      highestContiguousSeqRef.current = nextContiguous;
      const mergedList = reconcileMessageList(sortedBaseline, contiguousBuffered, optimisticMapRef.current);

      setMessages(mergedList);
      setLoading(false);

      if (outOfOrderBufferRef.current.length > 0 || highestContiguousSeqRef.current < serverLastSeqRef.current) {
        triggerRecovery();
      } else {
        setSyncStatus('synced');
      }
    } catch (err) {
      if (activeConvIdRef.current === convId) {
        console.error('Error loading baseline chat history:', err);
        setSyncError(err.message || 'Failed to load messages');
        setLoading(false);
        setSyncStatus('degraded');
      }
    }
  }, [currentUser, triggerRecovery]);

  // Main lifecycle effect: subscribe socket event before baseline load, clean up on unmount or switch
  useEffect(() => {
    if (!conversationId || !currentUser) {
      setMessages([]);
      setLoading(false);
      setSyncStatus('synced');
      return;
    }

    activeConvIdRef.current = conversationId;
    isInitialLoadingRef.current = true;
    hasLoadedBaselineRef.current = false;
    highestContiguousSeqRef.current = 0;
    lowestLoadedSeqRef.current = Infinity;
    serverLastSeqRef.current = 0;
    initialBufferRef.current = [];
    outOfOrderBufferRef.current = [];
    optimisticMapRef.current.clear();
    isRecoveringRef.current = false;
    setOtherLastReadSeq(0);

    setLoading(true);
    setSyncStatus('syncing');
    setSyncError(null);

    // 1. Subscribe to chat:message and chat:read BEFORE initiating baseline history loading
    const onChatMessage = (msg) => {
      if (!msg) return;
      const incomingConvId = normalizeConversationId(msg.conversationId);
      const currentConvId = normalizeConversationId(activeConvIdRef.current);
      if (!incomingConvId || !currentConvId || incomingConvId !== currentConvId) return;

      if (isInitialLoadingRef.current) {
        // Buffer incoming events while initial loading is in progress
        initialBufferRef.current.push(msg);
        return;
      }

      handleIncomingLiveMessage(msg);
    };

    const onChatRead = (payload) => {
      setOtherLastReadSeq(prev => handleChatReadEvent({
        currentReadSeq: prev,
        payload,
        activeConversationId: activeConvIdRef.current,
        targetUserId
      }));
    };

    if (socket) {
      socket.on('chat:message', onChatMessage);
      socket.on('chat:read', onChatRead);
    }

    // 2. Fetch baseline history
    loadBaseline(conversationId);

    return () => {
      if (socket) {
        socket.off('chat:message', onChatMessage);
        socket.off('chat:read', onChatRead);
      }
      isInitialLoadingRef.current = true;
      initialBufferRef.current = [];
      outOfOrderBufferRef.current = [];
    };
  }, [conversationId, currentUser, targetUserId, socket, handleIncomingLiveMessage, loadBaseline]);

  // Reconnect recovery effect: recover missed messages through REST upon socket reconnection (including seq 0)
  useEffect(() => {
    if (isConnected && hasLoadedBaselineRef.current && activeConvIdRef.current) {
      if (highestContiguousSeqRef.current >= 0) {
        triggerRecovery();
      }
    } else if (!isConnected && hasLoadedBaselineRef.current) {
      setSyncStatus('reconnecting');
    }
  }, [isConnected, triggerRecovery]);

  // Historical pagination (beforeSeq)
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMoreOlder || lowestLoadedSeqRef.current <= 1 || !conversationId) return false;

    setLoadingOlder(true);
    try {
      const token = await currentUser.getIdToken();
      const data = await getMessages(token, conversationId, {
        beforeSeq: lowestLoadedSeqRef.current,
        limit: 50
      });

      const olderMessages = (data.messages || []).map(m => ({ ...m, status: 'persisted' }));
      const hasMore = Boolean(data.hasMore);
      setHasMoreOlder(hasMore);

      if (olderMessages.length > 0) {
        let newLowest = lowestLoadedSeqRef.current;
        for (const m of olderMessages) {
          if (typeof m.seq === 'number' && m.seq > 0 && m.seq < newLowest) {
            newLowest = m.seq;
          }
        }
        lowestLoadedSeqRef.current = newLowest;

        setMessages(prev => reconcileMessageList(prev, olderMessages, optimisticMapRef.current));
        return true;
      } else {
        setHasMoreOlder(false);
        return false;
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
      return false;
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, currentUser, hasMoreOlder, loadingOlder]);

  // Send an optimistic message with a client-generated UUID v4
  const sendOptimisticMessage = useCallback(async (text, senderContext) => {
    if (!text || !text.trim() || !conversationId || !currentUser) return;
    const trimmed = text.trim();

    const clientMessageId = generateUUIDv4();
    const optimisticMsg = {
      _id: `temp-${clientMessageId}`,
      clientMessageId,
      conversationId,
      sender: currentUser.uid,
      senderDisplayName: currentUser.displayName || 'You',
      senderRole: senderContext || 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
      status: 'sending'
    };

    optimisticMapRef.current.set(clientMessageId, {
      msg: optimisticMsg,
      text: trimmed,
      senderContext
    });

    setMessages(prev => reconcileMessageList(prev, [optimisticMsg], optimisticMapRef.current));

    try {
      const token = await currentUser.getIdToken();
      const sentMsg = await apiSendMessage(token, conversationId, trimmed, clientMessageId, senderContext);

      optimisticMapRef.current.delete(clientMessageId);

      const confirmed = {
        ...sentMsg,
        status: 'persisted'
      };

      if (typeof confirmed.seq === 'number' && confirmed.seq > 0) {
        if (confirmed.seq === highestContiguousSeqRef.current + 1) {
          highestContiguousSeqRef.current = confirmed.seq;
          if (confirmed.seq > serverLastSeqRef.current) {
            serverLastSeqRef.current = confirmed.seq;
          }
        } else if (confirmed.seq > highestContiguousSeqRef.current + 1) {
          outOfOrderBufferRef.current.push(confirmed);
          triggerRecovery();
        }
      }

      setMessages(prev => reconcileMessageList(prev, [confirmed], optimisticMapRef.current));
      return confirmed;
    } catch (err) {
      console.error('Failed to send message:', err);
      const failedMsg = {
        ...optimisticMsg,
        status: 'failed',
        error: err.message || 'Send failed'
      };
      optimisticMapRef.current.set(clientMessageId, {
        msg: failedMsg,
        text: trimmed,
        senderContext
      });
      setMessages(prev => reconcileMessageList(prev, [failedMsg], optimisticMapRef.current));
      throw err;
    }
  }, [conversationId, currentUser, triggerRecovery]);

  // Retry sending a previously failed message with the exact same clientMessageId
  const retryMessage = useCallback(async (clientMessageId) => {
    const entry = optimisticMapRef.current.get(clientMessageId);
    if (!entry || !conversationId || !currentUser) return;

    const { text, senderContext } = entry;
    const retryingMsg = {
      ...entry.msg,
      status: 'sending',
      error: null
    };

    optimisticMapRef.current.set(clientMessageId, {
      ...entry,
      msg: retryingMsg
    });
    setMessages(prev => reconcileMessageList(prev, [retryingMsg], optimisticMapRef.current));

    try {
      const token = await currentUser.getIdToken();
      const sentMsg = await apiSendMessage(token, conversationId, text, clientMessageId, senderContext);

      optimisticMapRef.current.delete(clientMessageId);
      const confirmed = {
        ...sentMsg,
        status: 'persisted'
      };

      if (typeof confirmed.seq === 'number' && confirmed.seq > 0) {
        if (confirmed.seq === highestContiguousSeqRef.current + 1) {
          highestContiguousSeqRef.current = confirmed.seq;
        } else if (confirmed.seq > highestContiguousSeqRef.current + 1) {
          outOfOrderBufferRef.current.push(confirmed);
          triggerRecovery();
        }
      }

      setMessages(prev => reconcileMessageList(prev, [confirmed], optimisticMapRef.current));
      return confirmed;
    } catch (err) {
      console.error('Failed to retry message:', err);
      const failedMsg = {
        ...entry.msg,
        status: 'failed',
        error: err.message || 'Retry failed'
      };
      optimisticMapRef.current.set(clientMessageId, {
        ...entry,
        msg: failedMsg
      });
      setMessages(prev => reconcileMessageList(prev, [failedMsg], optimisticMapRef.current));
      throw err;
    }
  }, [conversationId, currentUser, triggerRecovery]);

  // Manual retry / refresh (used for degraded recovery UI state)
  const reloadBaseline = useCallback(() => {
    if (conversationId) {
      loadBaseline(conversationId);
    }
  }, [conversationId, loadBaseline]);

  return {
    messages,
    loading,
    syncStatus,
    hasMoreOlder,
    loadingOlder,
    loadOlderMessages,
    sendMessage: sendOptimisticMessage,
    retryMessage,
    syncError,
    reloadBaseline,
    otherLastReadSeq,
    setOtherLastReadSeq
  };
};
