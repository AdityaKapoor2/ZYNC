import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getProfile } from '../services/api';
import zyncLogo from '../assets/zync-logo.jpg';

const Dashboard = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchProfileData = async () => {
      if (!currentUser) return;
      
      try {
        const token = await currentUser.getIdToken();
        const data = await getProfile(token);
        
        if (!data.games || data.games.length === 0) {
          navigate('/onboarding');
          return;
        }
        
        setProfile(data);
      } catch (err) {
        console.error('Failed to fetch profile', err);
        setError('Failed to load profile data.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProfileData();
  }, [currentUser, navigate]);

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
        <p>Please log in to view the dashboard.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center font-sans">
        <p className="text-zync-blue font-bold tracking-widest uppercase">Loading Squad Data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-primary flex flex-col items-center justify-center font-sans">
        <p className="text-red-500 mb-4">{error}</p>
        <button onClick={handleLogout} className="text-zync-cyan hover:text-white transition-colors">
          Return to Login
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary font-sans relative overflow-x-hidden">
      {/* Background Glow */}
      <div className="fixed top-[-20%] left-[-10%] w-[800px] h-[800px] bg-zync-blue/5 blur-[150px] rounded-full pointer-events-none -z-10"></div>
      
      {/* Navbar */}
      <nav className="w-full py-6 px-8 flex justify-between items-center border-b border-border-subtle bg-bg-primary/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <img src={zyncLogo} alt="ZYNC Logo" className="w-10 h-10 object-contain" />
          <span className="text-xl font-extrabold tracking-tight text-white">ZYNC</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm font-bold text-text-secondary hidden md:block">
            {profile?.displayName || currentUser.email}
          </span>
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
        <header className="mb-12 flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight">
              YOUR SQUAD <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-blue to-zync-purple">DASHBOARD</span>
            </h1>
            <p className="text-text-secondary text-lg">Manage your profiles and find compatible teammates.</p>
          </div>
          <div className="flex gap-4">
            <button 
              onClick={() => navigate('/connections')}
              className="px-6 py-2 rounded font-bold text-sm border border-zync-cyan text-zync-cyan hover:bg-zync-cyan/10 transition-colors uppercase tracking-widest"
            >
              My Connections
            </button>
            <button 
              onClick={() => navigate('/onboarding?edit=true')}
              className="px-6 py-2 rounded font-bold text-sm border border-border-subtle text-text-secondary hover:text-white hover:border-white transition-colors uppercase tracking-widest"
            >
              Edit Profile
            </button>
          </div>
        </header>

        {/* Profile Stats */}
        <section className="mb-12">
          <h2 className="text-sm font-bold tracking-widest text-text-secondary uppercase mb-6 flex items-center gap-3">
            <div className="h-px bg-border-subtle flex-1"></div>
            ACTIVE GAME PROFILES
            <div className="h-px bg-border-subtle flex-1"></div>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {profile?.games?.map((game, index) => (
              <div key={index} className="bg-bg-card border border-border-subtle rounded-xl p-6 shadow-xl relative overflow-hidden group hover:border-zync-blue/50 transition-colors">
                <div className="absolute inset-0 bg-gradient-to-br from-zync-blue/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                
                <div className="relative z-10">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h3 className="text-xl font-extrabold text-white mb-1">{game.gameName}</h3>
                      <p className="text-sm text-zync-cyan font-medium">{game.inGameName}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full border border-border-subtle flex items-center justify-center bg-bg-secondary text-white font-bold">
                      {game.skillLevel}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1">Playstyle</p>
                      <p className="text-sm text-white">{game.playstyle || 'Not specified'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-text-secondary uppercase tracking-widest mb-1">Comms</p>
                      <p className="text-sm text-white">{game.communication || 'Not specified'}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        
        {/* Teammate Discovery Link */}
        <section className="mt-12 bg-bg-card border border-border-subtle rounded-xl p-12 text-center shadow-xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-zync-blue/10 to-zync-purple/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative z-10">
            <h3 className="text-2xl font-extrabold text-white mb-2 tracking-tight">DISCOVER YOUR SQUAD</h3>
            <p className="text-text-secondary text-base mb-8 max-w-md mx-auto">
              Our deterministic compatibility engine is ready to analyze playstyles and find the perfect teammates for you.
            </p>
            <button 
              onClick={() => navigate('/discover')}
              className="px-8 py-4 rounded font-extrabold text-sm bg-gradient-to-r from-zync-blue to-zync-purple hover:from-blue-500 hover:to-purple-500 transition-all text-white uppercase tracking-widest"
            >
              Scan for Matches
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
