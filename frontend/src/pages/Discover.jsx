import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import {
  getMatches,
  getConnections,
  getConnectionRequests,
  getSentConnections,
  sendConnectionRequest
} from '../services/api';
import Navbar from '../components/Navbar';

const Discover = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const selectedGame = queryParams.get('game');

  const [expandedCards, setExpandedCards] = useState({});
  const [matches, setMatches] = useState([]);
  const [connectionStatuses, setConnectionStatuses] = useState({});
  const [actionLoading, setActionLoading] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser) return;
      
      if (!selectedGame) {
        navigate('/dashboard');
        return;
      }

      try {
        const token = await currentUser.getIdToken();
        const [matchRes, connRes, incRes, sentRes] = await Promise.all([
          getMatches(token, selectedGame),
          getConnections(token),
          getConnectionRequests(token),
          getSentConnections(token)
        ]);

        setMatches(matchRes.matches || []);

        const statuses = {};
        // Map connected
        connRes.forEach(c => { statuses[c.user._id] = 'connected'; });
        // Map sent
        sentRes.forEach(r => { statuses[r.recipient._id] = 'sent'; });
        // Map incoming
        incRes.forEach(r => { statuses[r.requester._id] = 'incoming'; });

        setConnectionStatuses(statuses);
      } catch (err) {
        console.error('Failed to fetch discovery data', err);
        setError(err.message || 'Failed to load matches.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [currentUser, selectedGame, navigate]);

  const handleConnect = async (targetId) => {
    try {
      setActionLoading(prev => ({ ...prev, [targetId]: true }));
      const token = await currentUser.getIdToken();
      await sendConnectionRequest(token, targetId);
      setConnectionStatuses(prev => ({ ...prev, [targetId]: 'sent' }));
    } catch (err) {
      console.error(err);
      alert(err.message || 'Failed to send request');
    } finally {
      setActionLoading(prev => ({ ...prev, [targetId]: false }));
    }
  };



  if (!currentUser) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center font-sans">
        <p>Please log in to discover teammates.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center font-sans">
        <p className="text-zync-blue font-bold tracking-widest uppercase">Scanning for Matches...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center justify-center font-sans">
        <p className="text-red-500 mb-4">{error}</p>
        <Link to="/dashboard" className="text-zync-cyan hover:text-white transition-colors">
          Return to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-sans relative overflow-x-hidden">
      {/* Background Glow */}
      <div className="fixed top-[-20%] left-[-10%] w-[800px] h-[800px] bg-zync-purple/5 blur-[150px] rounded-full pointer-events-none -z-10"></div>

      {/* Navbar */}
      <Navbar />

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12">
        <header className="mb-8 md:mb-12">
          <h1 className="text-3xl md:text-4xl font-extrabold text-white mb-2 tracking-tight">
            DISCOVER <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-blue to-zync-purple">TEAMMATES</span>
          </h1>
          <p className="text-text-secondary text-sm md:text-lg">Finding teammates for {selectedGame}</p>
        </header>

        {matches.length === 0 ? (
          <section className="mt-8 md:mt-12 bg-bg-secondary/50 border border-border-subtle border-dashed rounded-xl p-6 md:p-12 text-center">
            <h3 className="text-lg md:text-xl font-bold text-white mb-2">No compatible teammates found yet.</h3>
            <p className="text-text-secondary text-xs md:text-sm mb-6 max-w-md mx-auto">
              We couldn't find any players that strongly match your game profiles and availability. Check back later as more players join!
            </p>
            <Link to="/dashboard" className="px-6 py-3 rounded font-bold text-sm bg-border-subtle text-white hover:bg-gray-600 transition-colors uppercase tracking-widest w-full sm:w-auto inline-block">
              Back to Dashboard
            </Link>
          </section>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5 md:gap-8">
            {matches.map((match) => (
              <div key={match.userId} className="bg-bg-card border border-border-subtle rounded-xl p-5 md:p-6 shadow-xl relative overflow-hidden group hover:border-zync-purple/50 transition-colors">
                <div className="absolute inset-0 bg-gradient-to-br from-zync-purple/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>

                <div className="relative z-10 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-6 gap-2">
                    <div>
                      <h3 className="text-xl md:text-2xl font-extrabold text-white mb-1 break-words">{match.displayName}</h3>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span className="text-xs font-bold bg-zync-blue/20 text-zync-cyan px-2 py-1 rounded">
                          {match.game}
                        </span>
                        <span className="text-xs md:text-sm text-text-secondary font-medium">IGN: {match.inGameName}</span>
                        {match.isOnline && (
                          <span className="flex items-center gap-1 text-[10px] md:text-xs font-bold text-zync-cyan bg-zync-cyan/10 px-2 py-0.5 rounded border border-zync-cyan/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-zync-cyan animate-pulse"></span>
                            ONLINE
                          </span>
                        )}
                      </div>

                      {match.reputation && match.reputation.count >= 5 ? (
                        <div className="text-xs font-bold text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded w-fit border border-yellow-400/20">
                          ⭐ {match.reputation.score.toFixed(1)} / 5.0 <span className="text-text-secondary ml-1 font-medium hidden sm:inline">({match.reputation.count} ratings)</span>
                        </div>
                      ) : (
                        <div className="text-xs font-bold text-text-secondary bg-bg-secondary px-2 py-1 rounded w-fit border border-border-subtle">
                          ⭐ New <span className="font-medium hidden sm:inline">· Not enough ratings</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right flex flex-col items-end shrink-0">
                      <div className="text-2xl md:text-3xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-zync-cyan to-zync-purple leading-none mb-1">
                        {match.compatibilityScore}%
                      </div>
                      <div className="text-[9px] md:text-[10px] font-bold text-text-secondary uppercase tracking-widest">Match</div>
                    </div>
                  </div>



                  {/* Toggle Full Compatibility */}
                  <button
                    onClick={() => setExpandedCards(prev => ({ ...prev, [match.userId]: !prev[match.userId] }))}
                    className="text-[10px] md:text-xs font-bold text-zync-cyan hover:text-white transition-colors uppercase tracking-widest mb-6 flex items-center gap-2 w-fit"
                  >
                    {expandedCards[match.userId] ? 'Hide Full Breakdown' : 'View Full Breakdown'}
                    <span className="text-sm md:text-base leading-none">{expandedCards[match.userId] ? '↑' : '↓'}</span>
                  </button>

                  {/* Breakdown */}
                  {expandedCards[match.userId] && (
                    <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
                      <div>
                        <div className="flex justify-between text-[10px] md:text-xs mb-1">
                          <span className="text-text-secondary font-bold uppercase">Skill</span>
                          <span className="text-white font-medium">{Math.min(10, Math.round((match.breakdown.skill / 25) * 10))}/10</span>
                        </div>
                        <div className="w-full bg-bg-secondary rounded-full h-1.5">
                          <div className="bg-zync-blue h-1.5 rounded-full" style={{ width: `${Math.min(100, (match.breakdown.skill / 25) * 100)}%` }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] md:text-xs mb-1">
                          <span className="text-text-secondary font-bold uppercase">Role</span>
                          <span className="text-white font-medium">{Math.min(10, Math.round((match.breakdown.role / 18) * 10))}/10</span>
                        </div>
                        <div className="w-full bg-bg-secondary rounded-full h-1.5">
                          <div className="bg-zync-purple h-1.5 rounded-full" style={{ width: `${Math.min(100, (match.breakdown.role / 18) * 100)}%` }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] md:text-xs mb-1">
                          <span className="text-text-secondary font-bold uppercase">Availability</span>
                          <span className="text-white font-medium">{Math.min(10, Math.round((match.breakdown.availability / 18) * 10))}/10</span>
                        </div>
                        <div className="w-full bg-bg-secondary rounded-full h-1.5">
                          <div className="bg-zync-cyan h-1.5 rounded-full" style={{ width: `${Math.min(100, (match.breakdown.availability / 18) * 100)}%` }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] md:text-xs mb-1">
                          <span className="text-text-secondary font-bold uppercase">Playstyle</span>
                          <span className="text-white font-medium">{Math.min(10, Math.round((match.breakdown.playstyle / 14) * 10))}/10</span>
                        </div>
                        <div className="w-full bg-bg-secondary rounded-full h-1.5">
                          <div className="bg-zync-blue h-1.5 rounded-full" style={{ width: `${Math.min(100, (match.breakdown.playstyle / 14) * 100)}%` }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] md:text-xs mb-1">
                          <span className="text-text-secondary font-bold uppercase">Communication</span>
                          <span className="text-white font-medium">{Math.min(10, Math.round((match.breakdown.communication / 10) * 10))}/10</span>
                        </div>
                        <div className="w-full bg-bg-secondary rounded-full h-1.5">
                          <div className="bg-zync-purple h-1.5 rounded-full" style={{ width: `${Math.min(100, (match.breakdown.communication / 10) * 100)}%` }}></div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] md:text-xs mb-1">
                          <span className="text-text-secondary font-bold uppercase">Reputation</span>
                          <span className="text-white font-medium">{Math.min(10, Math.round(((match.breakdown.reputation || 0) / 10) * 10))}/10</span>
                        </div>
                        <div className="w-full bg-bg-secondary rounded-full h-1.5">
                          <div className="bg-yellow-400 h-1.5 rounded-full" style={{ width: `${Math.min(100, ((match.breakdown.reputation || 0) / 10) * 100)}%` }}></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="mt-auto flex flex-col sm:flex-row gap-2 sm:gap-3 pt-4 border-t border-border-subtle/50">
                    <button
                      onClick={() => navigate(`/player/${match.userId}`)}
                      className="flex-1 py-3 rounded font-bold text-sm border border-border-subtle text-text-secondary hover:text-white hover:bg-bg-secondary transition-colors uppercase tracking-widest"
                    >
                      View Profile
                    </button>

                    {connectionStatuses[match.userId] === 'connected' && (
                      <button disabled className="flex-1 py-3 rounded font-bold text-sm bg-bg-secondary text-zync-cyan border border-zync-cyan/30 uppercase tracking-widest cursor-default">
                        Connected
                      </button>
                    )}
                    {connectionStatuses[match.userId] === 'sent' && (
                      <button disabled className="flex-1 py-3 rounded font-bold text-sm bg-bg-secondary text-text-secondary border border-border-subtle uppercase tracking-widest cursor-default">
                        Request Sent
                      </button>
                    )}
                    {connectionStatuses[match.userId] === 'incoming' && (
                      <button
                        onClick={() => navigate('/connections')}
                        className="flex-1 py-3 rounded font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-purple hover:from-blue-500 hover:to-purple-500 transition-all text-white uppercase tracking-widest"
                      >
                        Respond
                      </button>
                    )}
                    {!connectionStatuses[match.userId] && (
                      <button
                        onClick={() => handleConnect(match.userId)}
                        disabled={actionLoading[match.userId]}
                        className="flex-1 py-3 rounded font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-purple hover:from-blue-500 hover:to-purple-500 transition-all text-white uppercase tracking-widest disabled:opacity-50"
                      >
                        {actionLoading[match.userId] ? 'Sending...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default Discover;
