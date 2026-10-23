import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { getOrCreateConversation, markConversationAsRead } from '../services/api';
import { useChatSync } from '../hooks/useChatSync';
import ReportModal from '../components/ReportModal';
import RateModal from '../components/RateModal';
import Navbar from '../components/Navbar';

export const normalizeId = (val) => {
  if (!val) return '';
  if (typeof val === 'object' && val !== null) {
    const extracted = val._id || val.id || val;
    return extracted ? extracted.toString() : '';
  }
  return val.toString();
};

/**
 * Determines whether the "Seen" receipt should be displayed for each message in a direct conversation.
 * Returns an array of booleans corresponding 1:1 to messages array.
 */
export const computeSeenStatus = (messages, currentUserId, otherLastReadSeq) => {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const curIdStr = normalizeId(currentUserId);

  // Identify the latest message sent by current user
  let latestMyMessageIndex = -1;
  let latestMyMessageSeq = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const senderId = normalizeId(m?.sender);
    const isMine = Boolean(curIdStr && senderId === curIdStr);
    if (isMine) {
      latestMyMessageIndex = i;
      if (typeof m.seq === 'number' && m.seq > 0) {
        latestMyMessageSeq = m.seq;
      }
      break;
    }
  }

  return messages.map((m, index) => {
    const senderId = normalizeId(m?.sender);
    const isMine = Boolean(curIdStr && senderId === curIdStr);
    const isPending = m.status === 'sending';
    const isFailed = m.status === 'failed';
    const isLatestMyMessage = (index === latestMyMessageIndex);

    return Boolean(
      isMine &&
      isLatestMyMessage &&
      latestMyMessageSeq > 0 &&
      otherLastReadSeq >= latestMyMessageSeq &&
      !isPending &&
      !isFailed
    );
  });
};

const Chat = () => {
  const { userId: targetUserId } = useParams();
  const { currentUser } = useAuth();
  const { socket, isConnected } = useSocket();
  const navigate = useNavigate();

  const [conversation, setConversation] = useState(null);
  const [loadingConv, setLoadingConv] = useState(true);
  const [convError, setConvError] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [otherUser, setOtherUser] = useState(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const initialScrolledRef = useRef(false);
  const lastMarkedSeqRef = useRef(0);

  // Sequence-based real-time synchronization hook
  const {
    messages,
    loading: messagesLoading,
    syncStatus,
    hasMoreOlder,
    loadingOlder,
    loadOlderMessages,
    sendMessage: sendSyncMessage,
    retryMessage,
    syncError,
    reloadBaseline,
    otherLastReadSeq,
    setOtherLastReadSeq
  } = useChatSync({
    conversationId: conversation?._id,
    currentUser,
    targetUserId,
    socket,
    isConnected
  });

  // Reset scroll state and read sequence tracker whenever active conversation changes
  useEffect(() => {
    initialScrolledRef.current = false;
    isNearBottomRef.current = true;
    lastMarkedSeqRef.current = 0;
  }, [conversation?._id]);

  // Mark conversation read safely strictly up to the highest sequence actually loaded and displayed
  useEffect(() => {
    if (!currentUser || !conversation?._id || messagesLoading || !Array.isArray(messages) || messages.length === 0) {
      return;
    }

    const highestSeq = messages.reduce((max, msg) => {
      if (typeof msg.seq === 'number' && Number.isSafeInteger(msg.seq)) {
        return Math.max(max, msg.seq);
      }
      return max;
    }, 0);

    if (highestSeq > lastMarkedSeqRef.current) {
      const prevMarked = lastMarkedSeqRef.current;
      lastMarkedSeqRef.current = highestSeq;
      currentUser.getIdToken().then(token => {
        markConversationAsRead(token, conversation._id, highestSeq).then(() => {
          window.dispatchEvent(new Event('inboxReadStateChanged'));
        }).catch(err => {
          console.error('Failed to mark conversation as read:', err);
          if (lastMarkedSeqRef.current === highestSeq) {
            lastMarkedSeqRef.current = prevMarked;
          }
        });
      }).catch(err => {
        console.error('Failed to get token for markConversationAsRead:', err);
        if (lastMarkedSeqRef.current === highestSeq) {
          lastMarkedSeqRef.current = prevMarked;
        }
      });
    }
  }, [currentUser, conversation?._id, messages, messagesLoading]);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (behavior === 'auto') {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      }
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
  }, []);

  // Track if user is near bottom to avoid yanking viewport on incoming message
  const handleScroll = async () => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;

    // Trigger older history load when scrolled to top (< 20px), only after initial scroll has settled
    if (initialScrolledRef.current && el.scrollTop < 20 && hasMoreOlder && !loadingOlder) {
      const prevScrollHeight = el.scrollHeight;
      const prevScrollTop = el.scrollTop;

      const loaded = await loadOlderMessages();
      if (loaded) {
        // Preserve viewport position after prepending older messages
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const heightDiff = scrollContainerRef.current.scrollHeight - prevScrollHeight;
            scrollContainerRef.current.scrollTop = prevScrollTop + heightDiff;
          }
        });
      }
    }
  };

  // Position at bottom on initial baseline load (instant), and auto-scroll for subsequent new messages
  useEffect(() => {
    if (!initialScrolledRef.current && messages.length > 0 && !messagesLoading) {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
      } else {
        scrollToBottom('auto');
      }
      initialScrolledRef.current = true;
      isNearBottomRef.current = true;
    } else if (initialScrolledRef.current && isNearBottomRef.current) {
      scrollToBottom('smooth');
    }
  }, [messages, messagesLoading, scrollToBottom]);

  // Load conversation metadata and determine other participant
  useEffect(() => {
    let isCancelled = false;

    const loadConversation = async () => {
      if (!currentUser || !targetUserId) return;
      try {
        setLoadingConv(true);
        setConvError('');
        const token = await currentUser.getIdToken();
        const conv = await getOrCreateConversation(token, targetUserId);

        if (isCancelled) return;

        setConversation(conv);

        const targetIdStr = normalizeId(targetUserId);
        const targetUser = conv?.participants?.find(p => normalizeId(p) === targetIdStr);
        setOtherUser(targetUser || null);

        // Initialize receipt state from server-provided conversation read state
        const otherReadEntry = conv?.readState?.find(r => normalizeId(r?.user) === targetIdStr);
        if (otherReadEntry && typeof otherReadEntry.lastReadSeq === 'number') {
          setOtherLastReadSeq(prev => Math.max(prev, otherReadEntry.lastReadSeq));
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('Failed to load conversation:', err);
          setConvError(err.message || 'Failed to load conversation. Ensure you have an accepted connection with this user.');
        }
      } finally {
        if (!isCancelled) {
          setLoadingConv(false);
        }
      }
    };

    loadConversation();

    return () => {
      isCancelled = true;
    };
  }, [currentUser, targetUserId, setOtherLastReadSeq]);

  // Subscribe to real-time presence updates for target user
  useEffect(() => {
    if (!socket || !targetUserId) return;

    const targetIdStr = normalizeId(targetUserId);

    const handlePresenceUpdate = (data) => {
      if (!data || !data.userId) return;
      if (normalizeId(data.userId) === targetIdStr) {
        setOtherUser(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            isOnline: Boolean(data.isOnline),
            onlineUntil: data.isOnline
              ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
              : null,
            lastSeen: data.lastSeen || prev.lastSeen
          };
        });
      }
    };

    socket.on('presence:update', handlePresenceUpdate);

    return () => {
      socket.off('presence:update', handlePresenceUpdate);
    };
  }, [socket, targetUserId]);

  // Reconnect reconciliation: reconcile participant presence and read state on socket reconnect
  const wasConnectedChatRef = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnectedChatRef.current && currentUser && targetUserId) {
      currentUser.getIdToken().then(token => {
        getOrCreateConversation(token, targetUserId).then(conv => {
          const targetIdStr = normalizeId(targetUserId);
          const targetUser = conv?.participants?.find(p => normalizeId(p) === targetIdStr);
          if (targetUser) {
            setOtherUser(targetUser);
          }
          const otherReadEntry = conv?.readState?.find(r => normalizeId(r?.user) === targetIdStr);
          if (otherReadEntry && typeof otherReadEntry.lastReadSeq === 'number') {
            setOtherLastReadSeq(prev => Math.max(prev, otherReadEntry.lastReadSeq));
          }
        }).catch(err => {
          console.error('Failed to reconcile participant on reconnect:', err);
        });
      });
    }
    wasConnectedChatRef.current = isConnected;
  }, [isConnected, currentUser, targetUserId, setOtherLastReadSeq]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending || !conversation) return;

    try {
      setSending(true);
      const textToSend = newMessage;
      setNewMessage('');
      isNearBottomRef.current = true;
      await sendSyncMessage(textToSend);
      scrollToBottom('smooth');
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setSending(false);
    }
  };

  const initialLoading = loadingConv || (messagesLoading && messages.length === 0);

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-bg-primary text-white flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-bg-secondary border-t-zync-cyan rounded-full animate-spin mb-4"></div>
        <p className="text-text-secondary tracking-widest text-sm font-semibold">LOADING CHAT...</p>
      </div>
    );
  }

  if (convError) {
    return (
      <div className="min-h-screen bg-bg-primary p-6 flex flex-col items-center justify-center">
        <div className="bg-bg-card border border-border-subtle p-8 rounded-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-text-secondary mb-6">{convError}</p>
          <button 
            onClick={() => navigate('/connections')}
            className="px-6 py-2 bg-zync-blue text-white rounded font-bold uppercase tracking-widest text-sm hover:bg-blue-500 transition-colors"
          >
            Back to Squad
          </button>
        </div>
      </div>
    );
  }

  const isOnline = otherUser?.isOnline && new Date(otherUser.onlineUntil) > new Date();

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col font-sans">
      <Navbar />

      {/* Header */}
      <header className="bg-bg-card border-b border-border-subtle px-4 md:px-6 py-3 md:py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 sticky top-0 z-10">
        <div className="flex items-center gap-3 md:gap-4 w-full sm:w-auto min-w-0">
          <button 
            onClick={() => navigate('/connections')}
            className="text-text-secondary hover:text-white transition-colors whitespace-nowrap shrink-0 text-sm md:text-base font-semibold"
          >
            ← BACK
          </button>
          <div className="min-w-0 flex-1">
            <h1 
              className="text-base md:text-lg font-bold text-white leading-tight cursor-pointer hover:text-zync-cyan transition-colors truncate" 
              onClick={() => navigate(`/player/${otherUser?._id}`)}
            >
              {otherUser?.displayName || 'Player'}
            </h1>
            <div className="flex items-center gap-2 text-[10px] md:text-xs tracking-widest font-bold mt-0.5">
              {isOnline ? (
                <span className="text-green-400 flex items-center">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse mr-1"></span>
                  ONLINE
                </span>
              ) : (
                <span className="text-gray-500">OFFLINE</span>
              )}

              {/* Realtime synchronization indicator */}
              {syncStatus === 'syncing' && (
                <span className="text-zync-cyan text-[10px] tracking-normal font-medium flex items-center gap-1 animate-pulse">
                  <span>🔄</span> Syncing...
                </span>
              )}
              {syncStatus === 'reconnecting' && (
                <span className="text-amber-400 text-[10px] tracking-normal font-medium flex items-center gap-1">
                  <span>⚡</span> Reconnecting...
                </span>
              )}
              {syncStatus === 'degraded' && (
                <button 
                  onClick={reloadBaseline}
                  className="text-red-400 hover:text-red-300 text-[10px] tracking-normal font-medium underline flex items-center gap-1"
                  title={syncError || 'Sync degraded'}
                >
                  <span>⚠️</span> Sync paused · Retry
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto justify-end sm:justify-start">
          <button 
            onClick={() => setIsRateModalOpen(true)}
            className="flex-1 sm:flex-none px-3 md:px-4 py-2 sm:py-1.5 rounded font-bold text-[10px] md:text-xs bg-zync-blue text-white hover:bg-blue-600 transition-colors uppercase tracking-widest whitespace-nowrap text-center"
          >
            Rate Player
          </button>
          <button 
            onClick={() => setIsReportModalOpen(true)}
            className="flex-1 sm:flex-none px-3 md:px-4 py-2 sm:py-1.5 rounded font-bold text-[10px] md:text-xs bg-bg-secondary text-red-500 border border-red-500/30 hover:bg-red-500/10 transition-colors uppercase tracking-widest whitespace-nowrap text-center"
          >
            Report
          </button>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 md:p-6 bg-gradient-to-b from-bg-primary to-bg-card/50"
      >
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          {/* Older history loading spinner */}
          {loadingOlder && (
            <div className="flex justify-center py-2">
              <div className="w-5 h-5 border-2 border-bg-secondary border-t-zync-cyan rounded-full animate-spin"></div>
            </div>
          )}

          {messages.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                💬
              </div>
              <p className="px-4 text-sm md:text-base">This is the beginning of your chat history with {otherUser?.displayName}.</p>
            </div>
          ) : (() => {
            const targetIdStr = normalizeId(targetUserId);
            const myParticipant = conversation?.participants?.find(p => normalizeId(p) !== targetIdStr);
            const myId = normalizeId(myParticipant) || currentUser?.uid;

            const seenList = computeSeenStatus(messages, myId, otherLastReadSeq);

            return messages.map((msg, index) => {
              const senderId = normalizeId(msg?.sender);
              const isMine = Boolean(
                (myId && senderId && myId === senderId) ||
                (currentUser?.uid && msg?.sender === currentUser?.uid)
              );
              const isAdminMsg = msg?.senderRole === 'admin';
              const isPending = msg.status === 'sending';
              const isFailed = msg.status === 'failed';
              const msgKey = msg.clientMessageId || msg._id || index;
              const isSeen = Boolean(seenList[index]);

              return (
                <div 
                  key={msgKey} 
                  className={`flex flex-col ${isMine ? 'items-end' : 'items-start'} ${isPending ? 'opacity-70' : ''}`}
                >
                  {/* Sender identity label & badge */}
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className={`text-xs font-bold ${isAdminMsg ? 'text-red-400' : 'text-text-secondary'}`}>
                      {msg?.senderDisplayName || (isMine ? 'You' : otherUser?.displayName || 'Player')}
                    </span>
                    {isAdminMsg && (
                      <span className="text-[9px] uppercase font-extrabold tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 flex items-center gap-1">
                        <span>🛡️</span>
                        <span>ADMIN</span>
                      </span>
                    )}
                  </div>

                  <div 
                    className={`break-words max-w-[85%] md:max-w-[75%] px-4 py-3 rounded-2xl ${
                      isMine 
                        ? isFailed
                          ? 'bg-red-950/60 text-white border border-red-500/50 rounded-tr-sm'
                          : 'bg-gradient-to-br from-zync-blue to-blue-600 text-white rounded-tr-sm' 
                        : isAdminMsg
                          ? 'bg-red-500/10 text-white border border-red-500/30 rounded-tl-sm shadow-[0_0_15px_rgba(239,68,68,0.15)]'
                          : 'bg-bg-secondary text-white border border-border-subtle rounded-tl-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                  </div>

                  {/* Timestamp & Status Indicator */}
                  <div className="flex items-center gap-1.5 mt-1 px-1 text-[10px] text-text-secondary uppercase tracking-wider">
                    {isPending ? (
                      <span className="text-zync-cyan flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-zync-cyan animate-ping"></span>
                        Sending...
                      </span>
                    ) : isFailed ? (
                      <button
                        onClick={() => retryMessage(msg.clientMessageId)}
                        className="text-red-400 hover:text-red-300 font-bold underline cursor-pointer flex items-center gap-1"
                      >
                        Failed · Retry
                      </button>
                    ) : (
                      <>
                        <span>
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isSeen && (
                          <span className="text-zync-cyan font-bold tracking-normal capitalize" data-testid="seen-indicator">
                            Seen
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            });
          })()}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-bg-card border-t border-border-subtle p-3 md:p-4">
        <div className="max-w-4xl mx-auto relative">
          <form onSubmit={handleSendMessage} className="flex gap-2 min-w-0">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={`Message ${otherUser?.displayName || 'player'}...`}
              className="flex-1 min-w-0 bg-bg-secondary border border-border-subtle rounded-lg px-3 md:px-4 py-2.5 md:py-3 text-white focus:outline-none focus:border-zync-cyan transition-colors text-sm md:text-base"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || sending}
              className="px-4 md:px-6 py-2.5 md:py-3 shrink-0 bg-zync-purple hover:bg-purple-600 text-white font-bold text-xs md:text-sm uppercase tracking-widest rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              Send
            </button>
          </form>
        </div>
      </div>

      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
        reportedUserId={otherUser?._id}
        reportedUserName={otherUser?.displayName}
        conversationId={conversation?._id}
      />

      <RateModal
        isOpen={isRateModalOpen}
        onClose={() => setIsRateModalOpen(false)}
        targetUserId={otherUser?._id}
        targetUserName={otherUser?.displayName}
      />
    </div>
  );
};

export default Chat;
