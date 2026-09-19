import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getProfile } from '../services/api';
import Navbar from '../components/Navbar';

import bgmiLogo from '../assets/bgmi.jpg';
import valorantLogo from '../assets/valorant.png';
import brawlStarsLogo from '../assets/brawl-stars.png';

const getGameLogo = (gameName) => {
  switch(gameName?.toLowerCase()) {
    case 'valorant': return valorantLogo;
    case 'bgmi': return bgmiLogo;
    case 'brawl stars': return brawlStarsLogo;
    default: return null;
  }
};

const Dashboard = () => {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  
  const [profile, setProfile] = useState(null);
  const [selectedGame, setSelectedGame] = useState(null);
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
        if (data.games.length > 0) {
          setSelectedGame(data.games[0].gameName);
        }

      } catch (err) {
        console.error('Failed to fetch data', err);
        setError('Failed to load profile data.');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProfileData();
  }, [currentUser, navigate]);

  const handleLogout = async () => {
    try {
      if (logout) await logout();
      navigate('/login');
    } catch (e) {
      navigate('/login');
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

  const handleCopyId = (e, inGameName) => {
    e.stopPropagation();
    navigator.clipboard.writeText(inGameName);
  };

  return (
    <div className="min-h-screen bg-[#050810] text-text-primary font-sans relative overflow-x-hidden">
      {/* Background Glows */}
      <div className="fixed top-[-20%] left-[-10%] w-[800px] h-[800px] bg-zync-blue/15 blur-[150px] rounded-full pointer-events-none z-0"></div>
      <div className="fixed bottom-[-20%] right-[-10%] w-[800px] h-[800px] bg-zync-purple/15 blur-[150px] rounded-full pointer-events-none z-0"></div>
      
      {/* Navbar */}
      <div className="relative z-20">
        <Navbar />
      </div>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12 relative z-10">
        <header className="mb-2">
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Welcome back{profile?.displayName ? `, ${profile.displayName}` : ''}.
          </h1>
        </header>

        {/* Find New Teammates Hero CTA */}
        <section className="mb-10 md:mb-12 mt-4 relative overflow-hidden rounded-2xl bg-[#0A0F1E]/60 backdrop-blur-xl border border-white/10 p-6 md:p-8 flex flex-col items-start gap-6 shadow-2xl group">
          <div className="absolute inset-0 bg-gradient-to-br from-zync-blue/10 to-zync-purple/10 opacity-50 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
          
          <div className="relative z-10 w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <h2 className="text-xl md:text-3xl font-extrabold text-white mb-3 tracking-tight">Ready to find your next teammate?</h2>
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-white/60 text-sm font-medium">
                  {profile?.games?.length || 0} {(profile?.games?.length === 1) ? 'game' : 'games'} linked &middot; Ready to play
                </p>
                {selectedGame && (
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-bold text-white/90 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-zync-cyan shadow-[0_0_8px_rgba(34,211,238,0.8)]"></span>
                    Playing: {selectedGame}
                  </span>
                )}
              </div>
            </div>
            
            <button 
              onClick={() => navigate(`/discover?game=${encodeURIComponent(selectedGame)}`)}
              className="flex items-center justify-center gap-3 w-full md:w-auto h-[52px] px-8 rounded-xl font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-purple hover:brightness-110 hover:-translate-y-[1px] transition-all text-white shadow-[0_4px_15px_rgba(99,102,241,0.3)] hover:shadow-[0_8px_25px_rgba(99,102,241,0.5)] whitespace-nowrap"
            >
              Find New Teammates
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </section>

        {/* Profile Stats / My Games */}
        <section className="mb-10">
          <h2 className="text-sm font-bold tracking-widest text-white/50 uppercase mb-6 flex items-center gap-4">
            My Games <div className="h-px bg-white/5 flex-1"></div>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
            {profile?.games?.map((game, index) => {
              const isSelected = selectedGame === game.gameName;
              const logo = getGameLogo(game.gameName);

              return (
                <div 
                  key={index} 
                  onClick={() => setSelectedGame(game.gameName)}
                  className={`relative rounded-2xl p-[1px] cursor-pointer group transition-all duration-300 hover:-translate-y-1 ${isSelected ? 'bg-gradient-to-br from-zync-blue to-zync-purple shadow-[0_0_20px_rgba(99,102,241,0.2)]' : 'bg-white/10 hover:bg-white/20'}`}
                >
                  <div className={`bg-[#0A0F1E]/80 backdrop-blur-xl rounded-2xl p-6 h-full flex flex-col gap-4 relative overflow-hidden transition-colors ${isSelected ? 'bg-[#0A0F1E]/90' : ''}`}>
                    
                    {/* Subtle background logo */}
                    {logo && (
                      <img src={logo} alt="" className="absolute -right-4 -bottom-4 w-32 h-32 object-contain opacity-5 grayscale pointer-events-none group-hover:opacity-10 transition-opacity" />
                    )}

                    <div className="flex items-start justify-between relative z-10">
                      <div className="flex items-center gap-3">
                        {logo && (
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-black/50 border border-white/5 p-1 flex-shrink-0">
                            <img src={logo} alt={game.gameName} className="w-full h-full object-contain rounded-lg" />
                          </div>
                        )}
                        <h3 className={`text-lg font-bold tracking-wide ${isSelected ? 'text-white' : 'text-white/90'}`}>
                          {game.gameName}
                        </h3>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-gradient-to-r from-zync-blue to-zync-cyan flex items-center justify-center shadow-lg shadow-zync-blue/30 text-white flex-shrink-0 ml-2">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        </div>
                      )}
                    </div>

                    {/* Game ID & Skill */}
                    <div className="flex items-center flex-wrap gap-3 mt-2 relative z-10">
                      <div className="flex items-center gap-2 bg-black/40 border border-white/5 px-3 py-1.5 rounded-lg">
                        <span className="text-[10px] text-white/50 font-bold uppercase tracking-wider">ID</span>
                        <span className="text-sm text-zync-cyan font-bold tracking-wider">{game.inGameName}</span>
                        <button 
                          onClick={(e) => handleCopyId(e, game.inGameName)} 
                          className="text-white/40 hover:text-white ml-1 transition-colors"
                          title="Copy ID"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                        </button>
                      </div>

                      <div className="flex items-center gap-2 bg-black/40 border border-white/5 px-3 py-1.5 rounded-lg">
                        <span className="w-2 h-2 rounded-full bg-zync-cyan shadow-[0_0_8px_rgba(34,211,238,0.5)]"></span>
                        <span className="text-sm font-bold text-white/90">Skill {game.skillLevel}</span>
                      </div>
                    </div>
                    
                    {/* Attributes */}
                    <div className="flex flex-wrap items-center gap-2 mt-auto pt-2 relative z-10">
                      <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/70 font-medium capitalize">
                        {game.playstyle || 'Flex'}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/70 font-medium capitalize">
                        {game.communication || 'Comms'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
