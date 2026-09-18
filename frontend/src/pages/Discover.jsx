import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import { 
  getMatches, 
  getConnections, 
  getConnectionRequests, 
  getSentConnections,
  sendConnectionRequest
} from '../services/api';
import zyncLogo from '../assets/zync-logo.jpg';

const Discover = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  
  const [matches, setMatches] = useState([]);
  const [connectionStatuses, setConnectionStatuses] = useState({});
  const [actionLoading, setActionLoading] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      if (!currentUser) return;
      
      try {
        const token = await currentUser.getIdToken();
        const [matchRes, connRes, incRes, sentRes] = await Promise.all([
          getMatches(token),
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
  }, [currentUser]);

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

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Failed to log out', error);
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
      <nav className="w-full py-6 px-8 flex justify-between items-center border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <img src={zyncLogo} alt="ZYNC Logo" className="w-10 h-10 object-contain" />
          <span className="text-xl font-extrabold tracking-tight text-white">ZYNC</span>
        </div>
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="text-sm font-bold text-text-secondary hover:text-white transition-colors">
            Dashboard
          </Link>
          <button 
            onClick={handleLogout}
            className="text-xs font-bold tracking-widest text-text-secondary hover:text-white transition-colors uppercase"
          >
            Log Out
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-12">
        <header className="mb-12">
          <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">
            DISCOVER <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-blue to-zync-purple">TEAMMATES</span>
          </h1>
          <p className="text-text-secondary text-lg">Players compatible with your competitive needs.</p>
        </header>

        {matches.length === 0 ? (
          <section className="mt-12 bg-bg-secondary/50 border border-border-subtle border-dashed rounded-xl p-12 text-center">
            <h3 className="text-xl font-bold text-white mb-2">No compatible teammates found yet.</h3>
            <p className="text-text-secondary text-sm mb-6 max-w-md mx-auto">
              We couldn't find any players that strongly match your game profiles and availability. Check back later as more players join!
            </p>
            <Link to="/dashboard" className="px-6 py-3 rounded font-bold text-sm bg-border-subtle text-white hover:bg-gray-600 transition-colors uppercase tracking-widest">
              Back to Dashboard
            </Link>
          </section>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
            {matches.map((match) => (
              <div key={match.userId} className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-xl relative overflow-hidden group hover:border-zync-purple/50 transition-colors">
                <div className="absolute inset-0 bg-gradient-to-br from-zync-purple/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>
                
                <div className="relative z-10 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h3 className="text-2xl font-extrabold text-white mb-1">{match.displayName}</h3>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold bg-zync-blue/20 text-zync-cyan px-2 py-1 rounded">
                          {match.game}
                        </span>
                        <span className="text-sm text-text-secondary font-medium">IGN: {match.inGameName}</span>
                        {match.isOnline && (
                          <span className="flex items-center gap-1 text-xs font-bold text-zync-cyan ml-2 bg-zync-cyan/10 px-2 py-0.5 rounded border border-zync-cyan/20">
                            <span className="w-1.5 h-1.5 rounded-full bg-zync-cyan animate-pulse"></span>
                            ONLINE NOW
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-zync-cyan to-zync-purple">
                        {match.compatibilityScore}%
                      </div>
                      <div className="text-xs font-bold text-text-secondary uppercase tracking-widest">Compatible</div>
                    </div>
                  </div>

                  {/* Reasons */}
                  <div className="mb-6">
                    <p className="text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Why this match?</p>
                    <ul className="space-y-1">
                      {match.matchReasons.map((reason, idx) => (
                        <li key={idx} className="text-sm text-white flex items-center gap-2">
                          <span className="w-1.5 h-1.5 bg-zync-cyan rounded-full"></span>
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Breakdown */}
                  <div className="mb-8 grid grid-cols-2 gap-4">
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary font-bold uppercase">Skill</span>
                        <span className="text-white font-medium">{Math.round((match.breakdown.skill / 25) * 10)}/10</span>
                      </div>
                      <div className="w-full bg-bg-secondary rounded-full h-1.5">
                        <div className="bg-zync-blue h-1.5 rounded-full" style={{ width: `${(match.breakdown.skill / 25) * 100}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary font-bold uppercase">Role</span>
                        <span className="text-white font-medium">{Math.round((match.breakdown.role / 20) * 10)}/10</span>
                      </div>
                      <div className="w-full bg-bg-secondary rounded-full h-1.5">
                        <div className="bg-zync-purple h-1.5 rounded-full" style={{ width: `${(match.breakdown.role / 20) * 100}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary font-bold uppercase">Availability</span>
                        <span className="text-white font-medium">{Math.round((match.breakdown.availability / 20) * 10)}/10</span>
                      </div>
                      <div className="w-full bg-bg-secondary rounded-full h-1.5">
                        <div className="bg-zync-cyan h-1.5 rounded-full" style={{ width: `${(match.breakdown.availability / 20) * 100}%` }}></div>
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-text-secondary font-bold uppercase">Playstyle</span>
                        <span className="text-white font-medium">{Math.round((match.breakdown.playstyle / 15) * 10)}/10</span>
                      </div>
                      <div className="w-full bg-bg-secondary rounded-full h-1.5">
                        <div className="bg-zync-blue h-1.5 rounded-full" style={{ width: `${(match.breakdown.playstyle / 15) * 100}%` }}></div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="mt-auto flex gap-3">
                    <button 
                      onClick={() => navigate(`/player/${match.userId}`)}
                      className="flex-1 py-3 rounded font-bold text-sm border border-border-subtle text-white hover:bg-bg-secondary transition-colors uppercase tracking-widest"
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
