import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  getConnectionRequests, 
  acceptConnection,
  rejectConnection,
  getConversations,
  getProfile
} from '../services/api';
import Navbar from '../components/Navbar';

const Inbox = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchInboxData = async () => {
      if (!currentUser) return;
      try {
        setLoading(true);
        const token = await currentUser.getIdToken();
        const [incRes, convRes, userProfile] = await Promise.all([
          getConnectionRequests(token).catch(err => {
            console.error("Failed to load requests:", err);
            return [];
          }),
          getConversations(token).catch(err => {
            console.error("Failed to load conversations:", err);
            return [];
          }),
          getProfile(token).catch(err => {
            console.error("Failed to load profile:", err);
            return null;
          })
        ]);
        setIncomingRequests(Array.isArray(incRes) ? incRes : []);
        setConversations(Array.isArray(convRes) ? convRes : []);
        setProfile(userProfile);
      } catch (err) {
        console.error("Failed to load inbox data:", err);
        setError("Failed to load your inbox items.");
      } finally {
        setLoading(false);
      }
    };
    
    fetchInboxData();
  }, [currentUser]);

  const handleAccept = async (connectionId) => {
    try {
      const token = await currentUser.getIdToken();
      await acceptConnection(token, connectionId);
      setIncomingRequests(prev => prev.filter(req => req._id !== connectionId));
    } catch (err) {
      console.error(err);
      setError("Failed to accept connection request.");
    }
  };

  const handleReject = async (connectionId) => {
    try {
      const token = await currentUser.getIdToken();
      await rejectConnection(token, connectionId);
      setIncomingRequests(prev => prev.filter(req => req._id !== connectionId));
    } catch (err) {
      console.error(err);
      setError("Failed to reject connection request.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary text-white flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-bg-secondary border-t-zync-cyan rounded-full animate-spin mb-4"></div>
        <p className="text-text-secondary tracking-widest text-sm">LOADING INBOX...</p>
      </div>
    );
  }

  // Filter conversations that have at least one message for the inbox feed
  const activeConversations = conversations.filter(c => c.lastMessage || c.isModeration);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary relative overflow-hidden font-sans">
      <Navbar />
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-zync-blue/5 blur-[100px] rounded-full pointer-events-none -z-10"></div>
      
      <main className="max-w-4xl mx-auto px-4 md:px-6 py-8 md:py-12 relative z-10">
        <header className="mb-8 md:mb-12 flex justify-between items-end">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-2 tracking-tight">
              Stay connected with your <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-blue to-zync-cyan">squad.</span>
            </h1>
            <p className="text-text-secondary text-sm md:text-lg">Manage messages, official communications, and pending connection requests.</p>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded text-sm mb-8 font-medium">
            {error}
          </div>
        )}

        {/* 1. Messages & Official Communications Section */}
        <section className="mb-12">
          <h2 className="text-sm font-bold tracking-widest text-text-secondary uppercase mb-4 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-zync-blue"></span>
            Messages & Official Notices
            <div className="h-px bg-border-subtle flex-1 ml-2"></div>
          </h2>

          {activeConversations.length === 0 ? (
            <div className="bg-bg-card border border-border-subtle rounded-md p-6 md:p-8 text-center">
              <p className="text-white font-bold mb-2 text-base md:text-lg">No messages yet.</p>
              <p className="text-text-secondary text-sm">Direct communications from teammates and official moderation notices will appear here.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2 md:gap-3">
              {activeConversations.map(conv => {
                const currentUserIdStr = profile?._id?.toString();
                const otherParticipant = conv.participants?.find(p => {
                  const pId = (p?._id || p)?.toString();
                  return pId !== currentUserIdStr;
                });
                
                const isAdmin = conv.isModeration || conv.lastMessage?.senderRole === 'admin';
                const displayName = isAdmin 
                  ? (conv.lastMessage?.senderDisplayName || 'ZYNC Super Admin') 
                  : (otherParticipant?.displayName || 'Player');
                
                const preview = conv.lastMessage?.text || 'Conversation opened';
                const targetId = otherParticipant?._id || otherParticipant;

                return (
                  <div 
                    key={conv._id} 
                    onClick={() => !isAdmin && targetId && navigate(`/chat/${targetId}`)}
                    className={`bg-bg-card border rounded-md px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between transition-colors gap-4 ${
                      isAdmin 
                        ? 'border-red-500/20 bg-red-500/5 cursor-default' 
                        : 'border-border-subtle hover:bg-bg-secondary/50 cursor-pointer group'
                    }`}
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-bold text-white border ${
                        isAdmin 
                          ? 'bg-red-500/20 border-red-500/40 text-red-400' 
                          : 'bg-bg-secondary border-border-subtle'
                      }`}>
                        {isAdmin ? '🛡️' : (displayName?.charAt(0)?.toUpperCase() || '?')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className={`text-base font-bold leading-tight truncate ${isAdmin ? 'text-red-400' : 'text-white'}`}>
                            {displayName}
                          </h3>
                          {isAdmin && (
                            <span className="text-[9px] uppercase font-extrabold tracking-wider px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                              ADMIN
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-text-secondary truncate mt-1">
                          {preview}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                      {conv.lastMessage?.createdAt && (
                        <span className="text-xs text-text-secondary">
                          {new Date(conv.lastMessage.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {isAdmin ? (
                        <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider px-2 py-0.5 rounded bg-red-500/10 border border-red-500/20">
                          Official Notice
                        </span>
                      ) : (
                        <span className="text-xs font-bold text-zync-cyan uppercase tracking-wider group-hover:translate-x-1 transition-transform">
                          Open Chat &rarr;
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 2. Connection Requests Section */}
        <section className="mb-12">
          <h2 className="text-sm font-bold tracking-widest text-text-secondary uppercase mb-4 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-zync-cyan"></span>
            Connection Requests
            <div className="h-px bg-border-subtle flex-1 ml-2"></div>
          </h2>
          
          {incomingRequests.length === 0 ? (
             <div className="bg-bg-card border border-border-subtle rounded-md p-6 md:p-8 text-center">
               <p className="text-white font-bold mb-2 text-base md:text-lg">No new connection requests.</p>
               <p className="text-text-secondary text-sm">You're all caught up.</p>
             </div>
          ) : (
            <div className="flex flex-col gap-2 md:gap-3">
              {incomingRequests.map(req => (
                <div key={req._id} className="bg-bg-card border border-border-subtle rounded-md px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between hover:bg-bg-secondary/50 transition-colors gap-4">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="w-10 h-10 shrink-0 rounded-full bg-bg-secondary border border-border-subtle flex items-center justify-center text-white font-bold">
                      {req.requester.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-bold text-white leading-tight truncate">{req.requester.displayName}</h3>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {req.requester.games?.slice(0,2).map(g => (
                          <span key={g._id} className="text-[10px] uppercase font-bold tracking-wider text-text-secondary truncate max-w-full">
                            {g.gameName}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 sm:gap-3 w-full md:w-auto mt-2 md:mt-0 border-t md:border-none border-border-subtle/50 pt-3 md:pt-0">
                    <button 
                      onClick={() => handleAccept(req._id)}
                      className="flex-1 md:flex-none px-4 md:px-6 py-2 rounded font-bold text-xs bg-gradient-to-r from-zync-blue to-zync-cyan text-white hover:opacity-90 tracking-widest uppercase whitespace-nowrap text-center"
                    >
                      Accept
                    </button>
                    <button 
                      onClick={() => handleReject(req._id)}
                      className="flex-1 md:flex-none px-4 md:px-6 py-2 rounded font-bold text-xs border border-border-subtle text-text-secondary hover:text-white hover:border-gray-500 tracking-widest uppercase transition-colors whitespace-nowrap text-center"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};

export default Inbox;
