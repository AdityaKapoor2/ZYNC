import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { 
  getConnections, 
  getConnectionRequests, 
  getSentConnections,
  acceptConnection,
  rejectConnection 
} from '../services/api';

const Connections = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [connections, setConnections] = useState([]);
  const [incomingRequests, setIncomingRequests] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser) return;
      try {
        setLoading(true);
        const token = await currentUser.getIdToken();
        const [connRes, incRes, sentRes] = await Promise.all([
          getConnections(token),
          getConnectionRequests(token),
          getSentConnections(token)
        ]);
        
        setConnections(connRes);
        setIncomingRequests(incRes);
        setSentRequests(sentRes);
      } catch (err) {
        console.error("Failed to load connections:", err);
        setError("Failed to load your connections.");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [currentUser]);

  const handleAccept = async (connectionId) => {
    try {
      const token = await currentUser.getIdToken();
      await acceptConnection(token, connectionId);
      // Remove from incoming and add to connections in state
      const acceptedReq = incomingRequests.find(req => req._id === connectionId);
      if (acceptedReq) {
        setIncomingRequests(prev => prev.filter(req => req._id !== connectionId));
        setConnections(prev => [...prev, { connectionId: acceptedReq._id, user: acceptedReq.requester }]);
      }
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
        <p className="text-text-secondary tracking-widest text-sm">LOADING CONNECTIONS...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6 md:p-12 relative overflow-hidden font-sans">
      <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-zync-cyan/5 blur-[100px] rounded-full pointer-events-none -z-10"></div>
      
      <div className="max-w-6xl mx-auto relative z-10">
        <header className="mb-12 flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">
              YOUR <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-blue to-zync-purple">SQUAD</span>
            </h1>
            <p className="text-text-secondary text-lg">Manage your connections and requests.</p>
          </div>
          <button 
            onClick={() => navigate('/dashboard')}
            className="px-6 py-2 rounded font-bold text-sm bg-bg-secondary hover:bg-gray-700 text-white transition-all uppercase tracking-widest"
          >
            Dashboard
          </button>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded text-sm mb-8 font-medium">
            {error}
          </div>
        )}

        {/* Incoming Requests */}
        {incomingRequests.length > 0 && (
          <section className="mb-12">
            <h2 className="text-xl font-bold text-white mb-4 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-zync-cyan"></span>
              Incoming Requests
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {incomingRequests.map(req => (
                <div key={req._id} className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-xl">
                  <h3 className="text-lg font-bold text-white mb-1">{req.requester.displayName}</h3>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {req.requester.games?.map(g => (
                      <span key={g._id} className="text-xs bg-bg-secondary text-text-secondary px-2 py-1 rounded">
                        {g.gameName}
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleAccept(req._id)}
                      className="flex-1 py-2 rounded font-bold text-xs bg-gradient-to-r from-zync-blue to-zync-cyan text-white hover:opacity-90"
                    >
                      ACCEPT
                    </button>
                    <button 
                      onClick={() => handleReject(req._id)}
                      className="flex-1 py-2 rounded font-bold text-xs border border-border-subtle text-text-secondary hover:text-white hover:border-gray-500"
                    >
                      REJECT
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Accepted Connections */}
        <section className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4 uppercase tracking-widest flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-zync-purple"></span>
            My Connections
          </h2>
          {connections.length === 0 ? (
            <div className="bg-bg-card border border-border-subtle rounded-xl p-8 text-center">
              <p className="text-text-secondary">You don't have any connections yet.</p>
              <button 
                onClick={() => navigate('/discover')}
                className="mt-4 px-6 py-2 rounded font-bold text-sm bg-zync-blue hover:bg-blue-500 text-white transition-all uppercase tracking-widest"
              >
                Find Teammates
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {connections.map(conn => (
                <div 
                  key={conn.connectionId} 
                  className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-xl cursor-pointer hover:border-zync-purple transition-all"
                  onClick={() => navigate(`/player/${conn.user._id}`)}
                >
                  <h3 className="text-lg font-bold text-white mb-1">{conn.user.displayName}</h3>
                  <p className="text-xs text-text-secondary mb-4 uppercase">Connected Squad Member</p>
                  <div className="flex flex-wrap gap-2">
                    {conn.user.games?.map(g => (
                      <span key={g._id} className="text-xs bg-bg-secondary text-text-secondary px-2 py-1 rounded">
                        {g.gameName} - {g.inGameName}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Sent Requests */}
        {sentRequests.length > 0 && (
          <section>
            <h2 className="text-xl font-bold text-text-secondary mb-4 uppercase tracking-widest flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-gray-600"></span>
              Sent Requests
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {sentRequests.map(req => (
                <div key={req._id} className="bg-bg-secondary border border-border-subtle rounded-lg p-4 opacity-75">
                  <h3 className="text-sm font-bold text-white mb-1">{req.recipient.displayName}</h3>
                  <p className="text-xs text-zync-cyan">Request Pending</p>
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  );
};

export default Connections;
