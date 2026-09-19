import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { getProfile } from '../services/api';
import Navbar from '../components/Navbar';

const Dashboard = () => {
  const { currentUser } = useAuth();
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
      <Navbar />

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12">
        <header className="mb-8 md:mb-10">
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Welcome back{profile?.displayName ? `, ${profile.displayName}` : ''}.
          </h1>
        </header>



        {/* Profile Stats */}
        <section className="mb-8 md:mb-10">
          <h2 className="text-sm font-bold tracking-widest text-text-secondary uppercase mb-4">
            My Games
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 w-full">
            {profile?.games?.map((game, index) => (
              <div 
                key={index} 
                onClick={() => setSelectedGame(game.gameName)}
                className="relative rounded-lg p-[1px] bg-gradient-to-r from-yellow-500/70 to-orange-500/70 shadow-sm cursor-pointer group hover:from-yellow-500 hover:to-orange-500 transition-all"
              >
                <div className={`bg-bg-card rounded-lg p-4 md:p-5 h-full flex flex-col gap-3 transition-colors ${selectedGame === game.gameName ? 'shadow-[inset_0_0_15px_rgba(34,211,238,0.1)]' : ''}`}>
                  <div className="flex items-center justify-between">
                    <h3 className={`text-base md:text-lg font-bold ${selectedGame === game.gameName ? 'text-zync-cyan' : 'text-white'}`}>
                      {game.gameName}
                    </h3>
                    {selectedGame === game.gameName && (
                      <span className="text-[10px] uppercase tracking-widest text-zync-cyan font-bold bg-zync-cyan/10 px-2 py-0.5 rounded">Selected</span>
                    )}
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2 text-xs text-text-secondary font-medium">
                    <span className="px-2 py-0.5 rounded bg-bg-secondary text-white">{game.skillLevel}</span>
                    <span>&bull;</span>
                    <span className="capitalize">{game.playstyle || 'Flex'}</span>
                    <span>&bull;</span>
                    <span className="capitalize">{game.communication || 'Comms'}</span>
                  </div>
                  
                  <div className="text-xs text-zync-cyan font-bold tracking-wider mt-auto pt-1">
                    {game.inGameName}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
        
        {/* Teammate Discovery Link */}
        <section className="mt-8 bg-bg-card border border-border-subtle rounded-xl p-6 md:p-8 text-center shadow-md relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-zync-blue/5 to-zync-cyan/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative z-10 flex flex-col items-center">
            <h3 className="text-lg md:text-xl font-extrabold text-white mb-2 tracking-tight">Ready to find your next teammate?</h3>
            <p className="text-text-secondary text-xs md:text-sm mb-6 max-w-md mx-auto">
              Discover players who match your games, playstyle, roles, and availability.
            </p>
            <button 
              onClick={() => navigate(`/discover?game=${encodeURIComponent(selectedGame)}`)}
              className="px-6 py-2.5 rounded font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-cyan hover:opacity-90 transition-opacity text-white tracking-widest uppercase w-full sm:w-auto"
            >
              Find New Teammates
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
