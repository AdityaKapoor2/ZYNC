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
      <main className="max-w-6xl mx-auto px-6 py-12">
        <header className="mb-10">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            Welcome back{profile?.displayName ? `, ${profile.displayName}` : ''}.
          </h1>
        </header>



        {/* Profile Stats */}
        <section className="mb-10">
          <h2 className="text-sm font-bold tracking-widest text-text-secondary uppercase mb-4">
            My Games
          </h2>

          <div className="flex flex-col gap-2">
            {profile?.games?.map((game, index) => (
              <div 
                key={index} 
                onClick={() => setSelectedGame(game.gameName)}
                className={`bg-bg-card border rounded-md px-5 py-3 shadow-sm flex items-center justify-between group transition-colors cursor-pointer ${selectedGame === game.gameName ? 'border-zync-cyan shadow-md shadow-zync-cyan/10 bg-bg-secondary/20' : 'border-border-subtle hover:border-border-subtle/80'}`}
              >
                <div className="flex items-center gap-4">
                  <h3 className={`text-base font-bold min-w-[120px] ${selectedGame === game.gameName ? 'text-zync-cyan' : 'text-white'}`}>
                    {game.gameName}
                    {selectedGame === game.gameName && <span className="ml-2 text-xs uppercase tracking-widest text-zync-cyan font-bold bg-zync-cyan/10 px-2 py-0.5 rounded">Selected</span>}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-text-secondary font-medium">
                    <span className="px-2 py-0.5 rounded bg-bg-secondary text-white">{game.skillLevel}</span>
                    <span>&bull;</span>
                    <span className="capitalize">{game.playstyle || 'Flex'}</span>
                    <span>&bull;</span>
                    <span className="capitalize">{game.communication || 'Comms'}</span>
                  </div>
                </div>
                <div className="text-xs text-zync-cyan font-bold tracking-wider">
                  {game.inGameName}
                </div>
              </div>
            ))}
          </div>
        </section>
        
        {/* Teammate Discovery Link */}
        <section className="mt-8 bg-bg-card border border-border-subtle rounded-xl p-8 text-center shadow-md relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-zync-blue/5 to-zync-cyan/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative z-10 flex flex-col items-center">
            <h3 className="text-xl font-extrabold text-white mb-2 tracking-tight">Ready to find your next teammate?</h3>
            <p className="text-text-secondary text-sm mb-6 max-w-md mx-auto">
              Discover players who match your games, playstyle, roles, and availability.
            </p>
            <button 
              onClick={() => navigate(`/discover?game=${encodeURIComponent(selectedGame)}`)}
              className="px-6 py-2.5 rounded font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-cyan hover:opacity-90 transition-opacity text-white tracking-widest uppercase"
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
