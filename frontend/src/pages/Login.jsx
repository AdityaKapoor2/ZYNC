import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, Link } from 'react-router-dom';
import zyncLogo from '../assets/zync-logo.jpg';
import { verifyAuth, getProfile, setOnlineStatus } from '../services/api';

const Login = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, signup, loginWithGoogle } = useAuth();
  const navigate = useNavigate();

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      let userCredential;
      if (isLogin) {
        userCredential = await login(email, password);
      } else {
        userCredential = await signup(email, password);
      }

      await handleBackendAuth(userCredential.user);
    } catch (err) {
      setError(err.message || 'Failed to authenticate');
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setLoading(true);
    try {
      const userCredential = await loginWithGoogle();
      await handleBackendAuth(userCredential.user);
    } catch (err) {
      setError(err.message || 'Failed to authenticate with Google');
      setLoading(false);
    }
  };

  const handleBackendAuth = async (user) => {
    try {
      const token = await user.getIdToken();
      
      // Verify token on backend
      await verifyAuth(token);
      
      // Fetch user profile
      const profile = await getProfile(token);
      
      // Auto set online status
      try {
        await setOnlineStatus(token);
      } catch (err) {
        console.error('Failed to set initial online status', err);
      }
      
      if (!profile.games || profile.games.length === 0) {
        navigate('/onboarding');
      } else {
        navigate('/dashboard');
      }
    } catch (err) {
      setError(err.message || 'Backend authentication failed');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Subtle ambient background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-zync-purple/5 blur-[120px] rounded-full pointer-events-none -z-10"></div>

      {/* Navbar back button */}
      <Link to="/" className="absolute top-8 left-8 text-sm font-bold text-text-secondary hover:text-white transition-colors flex items-center gap-2">
        ← BACK TO HOME
      </Link>

      <div className="w-full max-w-md bg-bg-card rounded-xl p-8 border border-border-subtle shadow-2xl relative z-10">
        <div className="text-center mb-8">
          <img src={zyncLogo} alt="ZYNC Logo" className="w-12 h-12 object-contain mx-auto mb-6" />
          <h2 className="text-2xl font-extrabold tracking-tight text-white mb-2">
            {isLogin ? 'Welcome Back' : 'Join ZYNC'}
          </h2>
          <p className="text-sm text-text-secondary">
            {isLogin ? 'Enter your credentials to access your squad.' : 'Create an account to start building your squad.'}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded text-sm mb-6 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailAuth} className="space-y-5">
          <div>
            <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-cyan focus:ring-1 focus:ring-zync-cyan transition-colors text-sm"
              placeholder="gamer@example.com"
            />
          </div>
          <div>
            <label className="block text-xs font-bold tracking-widest text-text-secondary mb-2 uppercase">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-bg-primary border border-border-subtle rounded-lg px-4 py-3 text-white focus:outline-none focus:border-zync-cyan focus:ring-1 focus:ring-zync-cyan transition-colors text-sm"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg font-bold text-sm bg-gradient-to-r from-zync-blue to-zync-purple hover:brightness-110 transition-all text-white disabled:opacity-50 mt-2"
          >
            {loading ? 'Authenticating...' : (isLogin ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <div className="my-6 flex items-center gap-4">
          <div className="h-px bg-border-subtle flex-1"></div>
          <span className="text-xs font-bold text-text-secondary">Or</span>
          <div className="h-px bg-border-subtle flex-1"></div>
        </div>

        <button
          onClick={handleGoogleAuth}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-lg font-bold text-sm bg-white text-black hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <p className="mt-8 text-center text-sm text-text-secondary font-medium">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-zync-cyan hover:text-white transition-colors ml-1"
          >
            {isLogin ? 'Sign Up' : 'Log In'}
          </button>
        </p>
      </div>
    </div>
  );
};

export default Login;
