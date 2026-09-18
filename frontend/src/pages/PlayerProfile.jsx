import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  getPublicProfile, 
  getConnections, 
  getConnectionRequests, 
  getSentConnections,
  sendConnectionRequest
} from '../services/api';

const PlayerProfile = () => {
  const { id } = useParams();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Connection states
  const [connectionStatus, setConnectionStatus] = useState('none'); // 'none', 'connected', 'sent', 'incoming'
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser) return;
      try {
        setLoading(true);
        const token = await currentUser.getIdToken();
        
        // Fetch public profile and all connections
        const [profRes, connRes, incRes, sentRes] = await Promise.all([
          getPublicProfile(token, id),
          getConnections(token),
          getConnectionRequests(token),
          getSentConnections(token)
        ]);
        
        setProfile(profRes);

        // Determine connection status
        const isConnected = connRes.some(c => c.user._id === id);
        const isSent = sentRes.some(r => r.recipient._id === id);
        const isIncoming = incRes.some(r => r.requester._id === id);

        if (isConnected) setConnectionStatus('connected');
        else if (isSent) setConnectionStatus('sent');
        else if (isIncoming) setConnectionStatus('incoming');
        else setConnectionStatus('none');

      } catch (err) {
        console.error("Failed to load profile:", err);
        setError("Failed to load player profile or it doesn't exist.");
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [id, currentUser]);

  const handleConnect = async () => {
    if (!currentUser || connectionStatus !== 'none') return;
    try {
      setActionLoading(true);
      const token = await currentUser.getIdToken();
      await sendConnectionRequest(token, id);
      setConnectionStatus('sent');
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to send request');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary text-white flex flex-col items-center justify-center">
        <div className="w-12 h-12 border-4 border-bg-secondary border-t-zync-purple rounded-full animate-spin mb-4"></div>
        <p className="text-text-secondary tracking-widest text-sm">LOADING PROFILE...</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-bg-primary text-white flex flex-col items-center justify-center p-4">
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded mb-6 max-w-md text-center">
          {error || 'Profile not found'}
        </div>
        <button onClick={() => navigate(-1)} className="px-6 py-2 bg-bg-secondary rounded font-bold uppercase text-sm hover:text-white transition-colors">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary p-6 md:p-12 relative overflow-hidden font-sans">
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-zync-purple/5 blur-[120px] rounded-full pointer-events-none -z-10"></div>
      
      <div className="max-w-4xl mx-auto relative z-10">
        <button 
          onClick={() => navigate(-1)}
          className="mb-8 flex items-center text-text-secondary hover:text-white transition-colors text-sm font-bold tracking-widest uppercase"
        >
          ← Back
        </button>

        <div className="bg-bg-card border border-border-subtle rounded-xl p-8 shadow-2xl mb-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 border-b border-border-subtle pb-8">
            <div>
              <h1 className="text-4xl font-extrabold text-white mb-2">{profile.displayName}</h1>
              <div className="flex items-center gap-4">
                <p className="text-text-secondary tracking-widest uppercase text-sm">ZYNC Player Profile</p>
                {profile.reputation && profile.reputation.count >= 5 ? (
                  <div className="text-xs font-bold text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded border border-yellow-400/20">
                    ⭐ {profile.reputation.score.toFixed(1)} / 5.0 <span className="text-text-secondary ml-1 font-medium">({profile.reputation.count} ratings)</span>
                  </div>
                ) : (
                  <div className="text-xs font-bold text-text-secondary bg-bg-secondary px-2 py-1 rounded border border-border-subtle">
                    ⭐ New <span className="font-medium">· Not enough ratings yet</span>
                  </div>
                )}
              </div>
            </div>
            
            <div>
              {connectionStatus === 'connected' && (
                <button disabled className="px-8 py-3 rounded font-bold text-sm bg-bg-secondary text-zync-cyan border border-zync-cyan/30 uppercase tracking-widest cursor-default">
                  Connected
                </button>
              )}
              {connectionStatus === 'sent' && (
                <button disabled className="px-8 py-3 rounded font-bold text-sm bg-bg-secondary text-text-secondary border border-border-subtle uppercase tracking-widest cursor-default">
                  Request Sent
                </button>
              )}
              {connectionStatus === 'incoming' && (
                <button onClick={() => navigate('/connections')} className="px-8 py-3 rounded font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-purple text-white hover:opacity-90 uppercase tracking-widest shadow-lg">
                  Respond to Request
                </button>
              )}
              {connectionStatus === 'none' && (
                <button 
                  onClick={handleConnect}
                  disabled={actionLoading}
                  className="px-8 py-3 rounded font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-purple text-white hover:opacity-90 transition-all uppercase tracking-widest shadow-lg shadow-zync-purple/20 disabled:opacity-50"
                >
                  {actionLoading ? 'Sending...' : 'Connect'}
                </button>
              )}
            </div>
          </div>

          <div className="space-y-12">
            {profile.games?.map((game, idx) => (
              <div key={idx} className="bg-bg-secondary/50 rounded-lg p-6 border border-border-subtle">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-2xl font-bold text-white mb-1">{game.gameName}</h2>
                    <p className="text-zync-cyan font-mono">IGN: {game.inGameName}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-3xl font-extrabold text-white">{game.skillLevel}</span>
                    <span className="text-text-secondary text-sm ml-1">/ 100</span>
                    <p className="text-xs text-text-secondary uppercase tracking-widest mt-1">Skill</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">Roles</h3>
                    <div className="flex flex-wrap gap-2">
                      {game.roles?.map(r => (
                        <span key={r} className="bg-bg-secondary text-white text-sm px-3 py-1 rounded border border-border-subtle">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-3">Availability</h3>
                    <div className="flex flex-wrap gap-2">
                      {game.availability?.map(a => (
                        <span key={a} className="bg-zync-purple/10 text-zync-purple text-sm px-3 py-1 rounded border border-zync-purple/30">
                          {a}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border-subtle">
                    <div>
                      <span className="block text-xs text-text-secondary uppercase tracking-widest mb-1">Playstyle</span>
                      <span className="font-bold text-white">{game.playstyle || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="block text-xs text-text-secondary uppercase tracking-widest mb-1">Comms</span>
                      <span className="font-bold text-white">{game.communication || 'N/A'}</span>
                    </div>
                    <div>
                      <span className="block text-xs text-text-secondary uppercase tracking-widest mb-1">Goal</span>
                      <span className="font-bold text-white">{game.competitiveGoals || 'N/A'}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
};

export default PlayerProfile;
