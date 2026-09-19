import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getConnections, removeConnection } from '../services/api';
import Navbar from '../components/Navbar';

const Connections = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionToRemove, setConnectionToRemove] = useState(null);

  const handleRemoveClick = (conn) => {
    setConnectionToRemove(conn);
  };

  const confirmRemove = async () => {
    if (!connectionToRemove || !currentUser) return;
    try {
      setLoading(true);
      setError('');
      const token = await currentUser.getIdToken();
      await removeConnection(token, connectionToRemove.connectionId);
      setConnections(prev => prev.filter(c => c.connectionId !== connectionToRemove.connectionId));
      setConnectionToRemove(null);
    } catch (err) {
      console.error("Failed to remove connection:", err);
      setError("Failed to remove connection.");
      setConnectionToRemove(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser) return;
      try {
        setLoading(true);
        const token = await currentUser.getIdToken();
        const [connRes] = await Promise.all([
          getConnections(token)
        ]);
        
        setConnections(connRes);
      } catch (err) {
        console.error("Failed to load connections:", err);
        setError("Failed to load your connections.");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [currentUser]);


  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary text-white flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-bg-secondary border-t-zync-cyan rounded-full animate-spin mb-4"></div>
        <p className="text-text-secondary tracking-widest text-sm">LOADING CONNECTIONS...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary relative overflow-hidden font-sans">
      <Navbar />
      <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-zync-cyan/5 blur-[100px] rounded-full pointer-events-none -z-10"></div>
      
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12 relative z-10">
        <header className="mb-8 md:mb-12 flex justify-between items-end">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-2 tracking-tight">
              YOUR <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-blue to-zync-purple">SQUAD</span>
            </h1>
            <p className="text-text-secondary text-sm md:text-lg">Manage your connections and requests.</p>
          </div>
        </header>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded text-sm mb-8 font-medium">
            {error}
          </div>
        )}



        {/* Accepted Connections */}
        <section className="mb-12">
          <h2 className="text-sm font-bold tracking-widest text-text-secondary uppercase mb-4 flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-zync-purple"></span>
            My Connections
            <div className="h-px bg-border-subtle flex-1 ml-2"></div>
          </h2>
          {connections.length === 0 ? (
            <div className="bg-bg-card border border-border-subtle rounded-md p-6 md:p-8 text-center">
              <p className="text-text-secondary mb-4 text-sm md:text-base">You don't have any connections yet.</p>
              <button 
                onClick={() => navigate('/discover')}
                className="px-6 py-2 rounded font-bold text-sm bg-zync-blue hover:bg-blue-500 text-white transition-all uppercase tracking-widest w-full sm:w-auto"
              >
                Find Teammates
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 md:gap-3">
              {connections.map(conn => {
                const isOnline = conn.user.isOnline && new Date(conn.user.onlineUntil) > new Date();
                const primaryGame = conn.user.games?.[0];
                return (
                  <div 
                    key={conn.connectionId} 
                    className="bg-bg-card border border-border-subtle rounded-md px-4 md:px-6 py-4 flex flex-col md:flex-row md:items-center justify-between hover:bg-bg-secondary/50 transition-colors gap-4"
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div 
                        className="w-10 h-10 shrink-0 rounded-full bg-bg-secondary border border-border-subtle flex items-center justify-center text-white font-bold cursor-pointer hover:border-zync-purple transition-colors relative"
                        onClick={() => navigate(`/player/${conn.user._id}`)}
                      >
                        {conn.user.displayName.charAt(0).toUpperCase()}
                        {isOnline && (
                          <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-bg-card animate-pulse"></span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 
                            className="text-base font-bold text-white cursor-pointer hover:text-zync-cyan transition-colors leading-tight truncate" 
                            onClick={() => navigate(`/player/${conn.user._id}`)}
                          >
                            {conn.user.displayName}
                          </h3>
                        </div>
                        {primaryGame && (
                          <div className="flex flex-wrap items-center gap-2 md:gap-3 mt-1 text-xs text-text-secondary uppercase tracking-widest font-bold">
                            <span className="text-zync-cyan truncate max-w-full">{primaryGame.gameName}</span>
                            <span className="w-1 h-1 shrink-0 rounded-full bg-border-subtle"></span>
                            <span className="truncate">{primaryGame.skillLevel || 'N/A'}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-4 md:gap-6 w-full md:w-auto mt-2 md:mt-0 border-t md:border-none border-border-subtle/50 pt-3 md:pt-0">
                      <div className="text-right hidden md:block">
                        <div className="text-xs text-text-secondary uppercase tracking-widest font-bold">Reputation</div>
                        <div className="text-sm font-bold text-white flex items-center justify-end gap-1">
                          <span className="text-yellow-400">★</span> {conn.user.reputationScore ? (conn.user.reputationScore / 10).toFixed(1) : 'NEW'}
                        </div>
                      </div>
                      
                      <div className="flex gap-2 sm:gap-3 w-full sm:w-auto">
                        <button 
                          onClick={() => handleRemoveClick(conn)}
                          className="flex-1 sm:flex-none px-4 md:px-6 py-2 rounded font-bold text-xs bg-bg-secondary border border-border-subtle hover:border-red-500 hover:text-red-400 text-text-secondary transition-all uppercase tracking-widest text-center whitespace-nowrap"
                        >
                          Remove
                        </button>
                        <button 
                          onClick={() => navigate(`/chat/${conn.user._id}`)}
                          className="flex-1 sm:flex-none px-4 md:px-6 py-2 rounded font-bold text-xs bg-zync-purple hover:bg-purple-600 text-white transition-all uppercase tracking-widest text-center whitespace-nowrap"
                        >
                          Message
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {connectionToRemove && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="bg-bg-card border border-border-subtle rounded-md max-w-md w-full p-6 shadow-2xl relative">
              <h3 className="text-xl font-bold text-white mb-2">Remove connection?</h3>
              <p className="text-text-secondary mb-6 md:mb-8 text-sm md:text-base">
                Are you sure you want to remove <span className="text-white font-bold">{connectionToRemove.user.displayName}</span> from your connections?
              </p>
              
              <div className="flex flex-wrap-reverse sm:flex-nowrap gap-3 sm:gap-4 justify-end w-full">
                <button 
                  onClick={() => setConnectionToRemove(null)}
                  className="w-full sm:w-auto px-6 py-2.5 sm:py-2 rounded font-bold text-sm bg-bg-secondary border border-border-subtle text-text-secondary hover:text-white transition-all uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button 
                  onClick={confirmRemove}
                  className="w-full sm:w-auto px-6 py-2.5 sm:py-2 rounded font-bold text-sm bg-red-500/20 text-red-500 border border-red-500/50 hover:bg-red-500 hover:text-white transition-all uppercase tracking-widest"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
};

export default Connections;
