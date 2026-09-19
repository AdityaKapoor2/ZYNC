import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  getConnectionRequests, 
  acceptConnection,
  rejectConnection
} from '../services/api';
import Navbar from '../components/Navbar';

const Inbox = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchRequests = async () => {
      if (!currentUser) return;
      try {
        setLoading(true);
        const token = await currentUser.getIdToken();
        const incRes = await getConnectionRequests(token);
        setIncomingRequests(incRes);
      } catch (err) {
        console.error("Failed to load requests:", err);
        setError("Failed to load your connection requests.");
      } finally {
        setLoading(false);
      }
    };
    
    fetchRequests();
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

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary relative overflow-hidden font-sans">
      <Navbar />
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-zync-blue/5 blur-[100px] rounded-full pointer-events-none -z-10"></div>
      
      <main className="max-w-4xl mx-auto px-6 py-12 relative z-10">
        <header className="mb-12 flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">
              Stay connected with your <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-blue to-zync-cyan">teammates.</span>
            </h1>
            <p className="text-text-secondary text-lg">Manage connection requests and keep up with the people you play with.</p>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded text-sm mb-8 font-medium">
            {error}
          </div>
        )}

        <section className="mb-12">
          <h2 className="text-sm font-bold tracking-widest text-text-secondary uppercase mb-4 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-zync-cyan"></span>
            Connection Requests
            <div className="h-px bg-border-subtle flex-1 ml-2"></div>
          </h2>
          
          {incomingRequests.length === 0 ? (
             <div className="bg-bg-card border border-border-subtle rounded-md p-8 text-center">
               <p className="text-white font-bold mb-2 text-lg">No new connection requests.</p>
               <p className="text-text-secondary text-sm">You're all caught up.</p>
             </div>
          ) : (
            <div className="flex flex-col gap-2">
              {incomingRequests.map(req => (
                <div key={req._id} className="bg-bg-card border border-border-subtle rounded-md px-6 py-4 flex flex-col md:flex-row md:items-center justify-between hover:bg-bg-secondary/50 transition-colors gap-4">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-10 h-10 rounded-full bg-bg-secondary border border-border-subtle flex items-center justify-center text-white font-bold">
                      {req.requester.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white leading-tight">{req.requester.displayName}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        {req.requester.games?.slice(0,2).map(g => (
                          <span key={g._id} className="text-[10px] uppercase font-bold tracking-wider text-text-secondary">
                            {g.gameName}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-3 w-full md:w-auto">
                    <button 
                      onClick={() => handleAccept(req._id)}
                      className="flex-1 md:flex-none px-6 py-2 rounded font-bold text-xs bg-gradient-to-r from-zync-blue to-zync-cyan text-white hover:opacity-90 tracking-widest uppercase"
                    >
                      Accept
                    </button>
                    <button 
                      onClick={() => handleReject(req._id)}
                      className="flex-1 md:flex-none px-6 py-2 rounded font-bold text-xs border border-border-subtle text-text-secondary hover:text-white hover:border-gray-500 tracking-widest uppercase transition-colors"
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
