import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getOrCreateConversation, getMessages, sendMessage } from '../services/api';
import ReportModal from '../components/ReportModal';
import RateModal from '../components/RateModal';

const Chat = () => {
  const { userId: targetUserId } = useParams();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [otherUser, setOtherUser] = useState(null);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);

  const messagesEndRef = useRef(null);
  const pollInterval = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadConversation = async () => {
    try {
      const token = await currentUser.getIdToken();
      // This endpoint validates the connection and returns the conversation
      const conv = await getOrCreateConversation(token, targetUserId);
      setConversation(conv);
      
      // Determine the other participant
      // We don't have our own profile _id immediately, so find the one matching targetUserId
      const targetUser = conv.participants.find(p => p._id === targetUserId);
      setOtherUser(targetUser);

      const msgs = await getMessages(token, conv._id);
      setMessages(msgs);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load conversation. Ensure you have an accepted connection with this user.');
    } finally {
      setLoading(false);
    }
  };

  const fetchNewMessages = async () => {
    if (!conversation) return;
    try {
      const token = await currentUser.getIdToken();
      const msgs = await getMessages(token, conversation._id);
      setMessages(msgs);
    } catch (err) {
      console.error("Poll error:", err);
    }
  };

  useEffect(() => {
    if (currentUser && targetUserId) {
      setLoading(true);
      loadConversation();
    }
    
    // Cleanup on unmount
    return () => {
      if (pollInterval.current) {
        clearInterval(pollInterval.current);
      }
    };
  }, [currentUser, targetUserId]);

  useEffect(() => {
    // Start polling once conversation is loaded
    if (conversation && !pollInterval.current) {
      pollInterval.current = setInterval(fetchNewMessages, 3000); // poll every 3 seconds for MVP
    }
  }, [conversation]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending || !conversation) return;

    try {
      setSending(true);
      const token = await currentUser.getIdToken();
      const sentMsg = await sendMessage(token, conversation._id, newMessage);
      
      // Optimistically append message
      setMessages(prev => [...prev, sentMsg]);
      setNewMessage('');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary text-white flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-bg-secondary border-t-zync-cyan rounded-full animate-spin mb-4"></div>
        <p className="text-text-secondary tracking-widest text-sm">LOADING CHAT...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg-primary p-6 flex flex-col items-center justify-center">
        <div className="bg-bg-card border border-border-subtle p-8 rounded-xl max-w-md w-full text-center">
          <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-text-secondary mb-6">{error}</p>
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
      {/* Header */}
      <header className="bg-bg-card border-b border-border-subtle px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/connections')}
            className="text-text-secondary hover:text-white transition-colors"
          >
            ← BACK
          </button>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight cursor-pointer hover:text-zync-cyan transition-colors" onClick={() => navigate(`/player/${otherUser?._id}`)}>
              {otherUser?.displayName}
            </h1>
            <div className="flex items-center text-xs tracking-widest font-bold">
              {isOnline ? (
                <span className="text-green-400 flex items-center">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse mr-1"></span>
                  ONLINE
                </span>
              ) : (
                <span className="text-gray-500">OFFLINE</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsRateModalOpen(true)}
            className="px-4 py-1.5 rounded font-bold text-xs bg-zync-blue text-white hover:bg-blue-600 transition-colors uppercase tracking-widest"
          >
            Rate Player
          </button>
          <button 
            onClick={() => setIsReportModalOpen(true)}
            className="px-4 py-1.5 rounded font-bold text-xs bg-bg-secondary text-red-500 border border-red-500/30 hover:bg-red-500/10 transition-colors uppercase tracking-widest"
          >
            Report
          </button>
        </div>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 bg-gradient-to-b from-bg-primary to-bg-card/50">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          {messages.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">
              <div className="w-16 h-16 bg-bg-secondary rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                💬
              </div>
              <p>This is the beginning of your chat history with {otherUser?.displayName}.</p>
            </div>
          ) : (
            messages.map((msg, index) => {
              const isMine = msg.sender === conversation.participants.find(p => p._id !== targetUserId)?._id;
              
              return (
                <div key={msg._id || index} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                  <div 
                    className={`max-w-[75%] px-4 py-3 rounded-2xl ${
                      isMine 
                        ? 'bg-gradient-to-br from-zync-blue to-blue-600 text-white rounded-tr-sm' 
                        : 'bg-bg-secondary text-white border border-border-subtle rounded-tl-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                  </div>
                  <span className="text-[10px] text-text-secondary mt-1 px-1 uppercase tracking-wider">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-bg-card border-t border-border-subtle p-4">
        <div className="max-w-4xl mx-auto relative">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={`Message ${otherUser?.displayName}...`}
              className="flex-1 bg-bg-secondary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-cyan transition-colors"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!newMessage.trim() || sending}
              className="px-6 py-3 bg-zync-purple hover:bg-purple-600 text-white font-bold text-sm uppercase tracking-widest rounded-lg disabled:opacity-50 transition-colors"
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
