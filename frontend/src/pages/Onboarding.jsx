import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { updateProfile, getProfile } from '../services/api';
import zyncLogo from '../assets/zync-logo.png';

const SUPPORTED_GAMES = ['Valorant', 'BGMI', 'Brawl Stars'];

const Onboarding = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEditMode = searchParams.get('edit') === 'true';
  const [initialLoad, setInitialLoad] = useState(isEditMode);
  
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [displayName, setDisplayName] = useState('');
  const [selectedGames, setSelectedGames] = useState([]);
  
  // gameData: { 'Valorant': { inGameName: '', skillLevel: 50, ... } }
  const [gameData, setGameData] = useState({});
  const [currentGameIndex, setCurrentGameIndex] = useState(0);

  useEffect(() => {
    const loadProfile = async () => {
      if (isEditMode && currentUser) {
        try {
          const token = await currentUser.getIdToken();
          const profile = await getProfile(token);
          
          if (profile) {
            setDisplayName(profile.displayName || '');
            const gNames = profile.games?.map(g => g.gameName) || [];
            setSelectedGames(gNames);
            
            const gData = {};
            profile.games?.forEach(g => {
              gData[g.gameName] = g;
            });
            setGameData(gData);
          }
        } catch (err) {
          console.error("Failed to load profile:", err);
          setError("Failed to load your existing profile.");
        } finally {
          setInitialLoad(false);
        }
      }
    };
    
    loadProfile();
  }, [isEditMode, currentUser]);

  const handleNextStep1 = () => {
    if (!displayName.trim()) {
      setError('Please enter a display name');
      return;
    }
    setError('');
    setStep(2);
  };

  const handleGameToggle = (game) => {
    setSelectedGames(prev => 
      prev.includes(game) 
        ? prev.filter(g => g !== game)
        : [...prev, game]
    );
  };

  const handleNextStep2 = () => {
    if (selectedGames.length === 0) {
      setError('Please select at least one game');
      return;
    }
    
    // Initialize gameData for newly selected games
    const initialData = { ...gameData };
    selectedGames.forEach(game => {
      if (!initialData[game]) {
        initialData[game] = {
          gameName: game,
          inGameName: '',
          skillLevel: '',
          roles: [],
          availability: [],
          playstyle: '',
          communication: '',
          competitiveGoals: ''
        };
      }
    });
    setGameData(initialData);
    
    setError('');
    setCurrentGameIndex(0);
    setStep(3);
  };

  const handleGameDataChange = (field, value) => {
    const game = selectedGames[currentGameIndex];
    setGameData(prev => ({
      ...prev,
      [game]: {
        ...prev[game],
        [field]: value
      }
    }));
  };

  const handleNextGameInfo = () => {
    const game = selectedGames[currentGameIndex];
    const data = gameData[game];
    
    if (!data.inGameName.trim()) {
      setError('In-game name is required');
      return;
    }
    if (data.skillLevel === '' || isNaN(data.skillLevel) || data.skillLevel < 1 || data.skillLevel > 100) {
      setError('Skill Level (1-100) is required');
      return;
    }
    if (!data.roles || data.roles.length === 0) {
      setError('Please select at least one role');
      return;
    }
    if (!data.availability || data.availability.length === 0) {
      setError('Please select at least one availability slot');
      return;
    }
    if (!data.playstyle) {
      setError('Playstyle is required');
      return;
    }
    if (!data.communication) {
      setError('Communication preference is required');
      return;
    }
    if (!data.competitiveGoals) {
      setError('Competitive Goal is required');
      return;
    }
    
    setError('');
    if (currentGameIndex < selectedGames.length - 1) {
      setCurrentGameIndex(prev => prev + 1);
    } else {
      submitProfile();
    }
  };

  const submitProfile = async () => {
    setLoading(true);
    setError('');
    try {
      const token = await currentUser.getIdToken();
      
      const gamesArray = selectedGames.map(game => gameData[game]);
      
      await updateProfile(token, {
        displayName,
        games: gamesArray
      });
      
      navigate('/dashboard');
    } catch (err) {
      setError(err.message || 'Failed to save profile');
      setLoading(false);
    }
  };

  if (!currentUser || initialLoad) {
    return (
      <div className="min-h-screen bg-bg-primary text-white flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-4 relative overflow-hidden font-sans">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-zync-purple/5 blur-[120px] rounded-full pointer-events-none -z-10"></div>
      
      <div className="w-full max-w-lg bg-bg-card rounded-xl p-6 md:p-8 border border-border-subtle shadow-2xl relative z-10">
        <div className="text-center mb-6 md:mb-8">
          <img src={zyncLogo} alt="ZYNC Logo" className="w-10 h-10 md:w-12 md:h-12 object-contain mx-auto mb-4 md:mb-6" />
          <h2 className="text-xl md:text-2xl font-extrabold tracking-tight text-white mb-2">
            {isEditMode ? 'Edit Your Profile' : 'Build Your Profile'}
          </h2>
          <div className="flex justify-center gap-2 mt-4">
            <div className={`h-1.5 w-8 md:w-12 rounded ${step >= 1 ? 'bg-zync-cyan' : 'bg-bg-secondary'}`}></div>
            <div className={`h-1.5 w-8 md:w-12 rounded ${step >= 2 ? 'bg-zync-blue' : 'bg-bg-secondary'}`}></div>
            <div className={`h-1.5 w-8 md:w-12 rounded ${step >= 3 ? 'bg-zync-purple' : 'bg-bg-secondary'}`}></div>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded text-sm mb-6 font-medium break-words">
            {error}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-6">
            <div>
              <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-cyan focus:ring-1 focus:ring-zync-cyan transition-colors text-sm"
                placeholder="How should we call you?"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
              {isEditMode && (
                <button
                  onClick={() => navigate('/dashboard')}
                  className="w-full sm:w-1/3 py-3 rounded-lg font-bold text-sm bg-bg-secondary hover:bg-gray-700 text-white transition-all"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={handleNextStep1}
                className={`w-full ${isEditMode ? 'sm:w-2/3' : ''} py-3 rounded-lg font-bold text-sm bg-zync-cyan hover:brightness-110 text-black transition-all`}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase text-center">Select Your Games</label>
            <div className="grid gap-3">
              {SUPPORTED_GAMES.map(game => (
                <button
                  key={game}
                  onClick={() => handleGameToggle(game)}
                  className={`py-3 md:py-4 px-4 md:px-6 rounded border transition-all flex items-center justify-between
                    ${selectedGames.includes(game) 
                      ? 'bg-zync-blue/10 border-zync-blue text-white' 
                      : 'bg-bg-secondary border-border-subtle text-text-secondary hover:border-gray-500'}`}
                >
                  <span className="font-bold truncate">{game}</span>
                  {selectedGames.includes(game) && (
                    <svg className="w-5 h-5 text-zync-blue flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                  )}
                </button>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mt-6">
              <button
                onClick={() => setStep(1)}
                className="w-full sm:w-1/3 py-3 rounded-lg font-bold text-sm bg-bg-secondary hover:bg-gray-700 text-white transition-all"
              >
                Back
              </button>
              <button
                onClick={handleNextStep2}
                className="w-full sm:w-2/3 py-3 rounded-lg font-bold text-sm bg-zync-blue hover:brightness-110 text-white transition-all"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5 md:space-y-6 animate-in fade-in">
            <div className="text-center mb-4 md:mb-6">
              <span className="text-xs font-bold tracking-widest text-zync-purple uppercase bg-zync-purple/10 px-3 py-1 rounded-full break-words inline-block max-w-full">
                {selectedGames[currentGameIndex]} Profile ({currentGameIndex + 1}/{selectedGames.length})
              </span>
            </div>
            
            <div>
              <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">In-Game Name (IGN)</label>
              <input
                type="text"
                value={gameData[selectedGames[currentGameIndex]]?.inGameName || ''}
                onChange={(e) => handleGameDataChange('inGameName', e.target.value)}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-purple focus:ring-1 focus:ring-zync-purple transition-colors text-sm"
                placeholder={`Your IGN in ${selectedGames[currentGameIndex]}`}
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Playstyle</label>
              <select
                value={gameData[selectedGames[currentGameIndex]]?.playstyle || ''}
                onChange={(e) => handleGameDataChange('playstyle', e.target.value)}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-purple focus:ring-1 focus:ring-zync-purple transition-colors text-sm appearance-none truncate"
              >
                <option value="" disabled>Select playstyle</option>
                <option value="Aggressive">Aggressive / Entry</option>
                <option value="Passive">Passive / Support</option>
                <option value="Flex">Flex / Adaptable</option>
                <option value="Strategic">Strategic / IGL</option>
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Communication</label>
              <select
                value={gameData[selectedGames[currentGameIndex]]?.communication || ''}
                onChange={(e) => handleGameDataChange('communication', e.target.value)}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-purple focus:ring-1 focus:ring-zync-purple transition-colors text-sm appearance-none truncate"
              >
                <option value="" disabled>Select communication style</option>
                <option value="Mic Required">Mic Required - Highly Communicative</option>
                <option value="Pings Only">Pings Only - Quiet</option>
                <option value="Casual Chat">Casual Chat</option>
              </select>
            </div>
            
            <div>
              <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Self-Rated Skill Level (1-100)</label>
              <input
                type="number"
                min="1"
                max="100"
                value={gameData[selectedGames[currentGameIndex]]?.skillLevel || ''}
                onChange={(e) => handleGameDataChange('skillLevel', e.target.value === '' ? '' : parseInt(e.target.value))}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-purple focus:ring-1 focus:ring-zync-purple transition-colors text-sm"
                placeholder="e.g. 75"
              />
            </div>
            
            <div>
              <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Roles (Select multiple)</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
                {['Duelist/Entry', 'Support', 'Controller/Smokes', 'Initiator', 'IGL', 'Flex', 'Sniper', 'Tank'].map(role => (
                  <button
                    key={role}
                    onClick={() => {
                      const currentRoles = gameData[selectedGames[currentGameIndex]]?.roles || [];
                      const newRoles = currentRoles.includes(role) 
                        ? currentRoles.filter(r => r !== role)
                        : [...currentRoles, role];
                      handleGameDataChange('roles', newRoles);
                    }}
                    className={`py-2 md:py-2.5 px-3 rounded border transition-all text-xs font-bold text-left truncate
                      ${gameData[selectedGames[currentGameIndex]]?.roles?.includes(role)
                        ? 'bg-zync-purple/20 border-zync-purple text-white' 
                        : 'bg-bg-secondary border-border-subtle text-text-secondary hover:border-gray-500'}`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Availability</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 md:gap-3">
                {['Weekday Evenings', 'Weekday Days', 'Weekends', 'Late Night', 'Flexible'].map(time => (
                  <button
                    key={time}
                    onClick={() => {
                      const currentTimes = gameData[selectedGames[currentGameIndex]]?.availability || [];
                      const newTimes = currentTimes.includes(time) 
                        ? currentTimes.filter(t => t !== time)
                        : [...currentTimes, time];
                      handleGameDataChange('availability', newTimes);
                    }}
                    className={`py-2 md:py-2.5 px-3 rounded border transition-all text-xs font-bold text-left truncate
                      ${gameData[selectedGames[currentGameIndex]]?.availability?.includes(time)
                        ? 'bg-zync-purple/20 border-zync-purple text-white' 
                        : 'bg-bg-secondary border-border-subtle text-text-secondary hover:border-gray-500'}`}
                  >
                    {time}
                  </button>
                ))}
              </div>
            </div>
            
            <div>
              <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Competitive Goal</label>
              <select
                value={gameData[selectedGames[currentGameIndex]]?.competitiveGoals || ''}
                onChange={(e) => handleGameDataChange('competitiveGoals', e.target.value)}
                className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-purple focus:ring-1 focus:ring-zync-purple transition-colors text-sm appearance-none truncate"
              >
                <option value="" disabled>Select your goal</option>
                <option value="Casual / For Fun">Casual / For Fun</option>
                <option value="Ranked Climbing">Ranked Climbing</option>
                <option value="Amateur Tournaments">Amateur Tournaments</option>
                <option value="Collegiate / Pro">Collegiate / Pro-level</option>
              </select>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mt-6 md:mt-8">
              <button
                onClick={() => {
                  if (currentGameIndex > 0) {
                    setCurrentGameIndex(prev => prev - 1);
                  } else {
                    setStep(2);
                  }
                }}
                disabled={loading}
                className="w-full sm:w-1/3 py-3 rounded-lg font-bold text-sm bg-bg-secondary hover:bg-gray-700 text-white transition-all disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={handleNextGameInfo}
                disabled={loading}
                className="w-full sm:w-2/3 py-3 rounded-lg font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-purple hover:brightness-110 text-white transition-all disabled:opacity-50"
              >
                {loading ? 'Saving...' : (currentGameIndex < selectedGames.length - 1 ? 'Next Game' : 'Complete Profile')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
