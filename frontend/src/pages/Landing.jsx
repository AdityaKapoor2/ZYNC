import React from 'react';
import { Link } from 'react-router-dom';

import zyncLogo from '../assets/zync-logo.jpg';

const Landing = () => {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary selection:bg-zync-purple/30 font-sans relative overflow-hidden">

      {/* Subtle ambient background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-zync-blue/10 blur-[120px] rounded-full pointer-events-none -z-10"></div>

      <nav className="container mx-auto px-6 py-6 flex justify-between items-center relative z-10 border-b border-border-subtle/30 mb-8">
        <div className="flex items-center gap-3">
          <img src={zyncLogo} alt="ZYNC Logo" className="w-10 h-10 object-contain" />
          <span className="text-xl font-bold tracking-widest text-text-primary">
            ZYNC
          </span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-text-secondary tracking-wide">
          <span className="hover:text-text-primary transition-colors cursor-pointer">Discover</span>
          <span className="hover:text-text-primary transition-colors cursor-pointer">How It Works</span>
        </div>
        <div>
          <Link to="/login" className="text-sm font-bold tracking-wide hover:text-white transition-colors px-6 py-2.5 rounded-md bg-bg-secondary border border-border-subtle hover:border-zync-blue/50">
            Sign In
          </Link>
        </div>
      </nav>

      <main className="container mx-auto px-6 pt-16 pb-32 relative z-10">
        <div className="max-w-4xl mx-auto text-center">

          {/* Subtle label */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bg-card border border-border-subtle text-xs font-semibold tracking-widest text-zync-cyan mb-8 uppercase">
            <span className="w-2 h-2 rounded-full bg-zync-cyan animate-pulse"></span>
            Esports Compatibility Engine
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold mb-6 tracking-tight">
            Find teammates who <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-purple via-zync-blue to-zync-cyan">
              actually match your style.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-text-secondary mb-12 max-w-2xl mx-auto leading-relaxed">
            Stop relying on random matchmaking. ZYNC structures and evaluates compatibility across skill, roles, and competitive goals to find the perfect squad.
          </p>

          <Link to="/login" className="inline-flex items-center justify-center px-8 py-4 rounded-md font-bold text-base bg-gradient-to-r from-zync-blue to-zync-purple hover:from-blue-500 hover:to-purple-500 transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)] hover:shadow-[0_0_30px_rgba(59,130,246,0.5)] text-white">
            Find Your Squad
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mt-32">

          {/* Feature 1 */}
          <div className="bg-bg-card border border-border-subtle p-8 rounded-xl hover:border-border-subtle/80 transition-colors relative group overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <div className="text-6xl font-black text-zync-blue">01</div>
            </div>
            <h3 className="text-sm font-bold tracking-widest text-zync-blue mb-6 uppercase">Supported Games</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm border-b border-border-subtle/50 pb-2">
                <span className="text-text-secondary">TITLE</span>
                <span className="font-semibold">BGMI</span>
              </div>
              <div className="flex items-center justify-between text-sm border-b border-border-subtle/50 pb-2">
                <span className="text-text-secondary">TITLE</span>
                <span className="font-semibold">VALORANT</span>
              </div>
              <div className="flex items-center justify-between text-sm border-b border-border-subtle/50 pb-2">
                <span className="text-text-secondary">TITLE</span>
                <span className="font-semibold">BRAWL STARS</span>
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="bg-bg-card border border-border-subtle p-8 rounded-xl hover:border-border-subtle/80 transition-colors relative group overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <div className="text-6xl font-black text-zync-purple">02</div>
            </div>
            <h3 className="text-sm font-bold tracking-widest text-zync-purple mb-6 uppercase">Compatibility Engine</h3>
            <div className="grid grid-cols-2 gap-x-4 gap-y-4 text-xs font-semibold tracking-wider">
              <div className="bg-bg-secondary border border-border-subtle p-3 rounded text-center">
                <div className="text-text-secondary mb-1">SKILL</div>
                <div className="text-zync-cyan">IMMORTAL</div>
              </div>
              <div className="bg-bg-secondary border border-border-subtle p-3 rounded text-center">
                <div className="text-text-secondary mb-1">ROLE</div>
                <div className="text-zync-cyan">DUELIST</div>
              </div>
              <div className="bg-bg-secondary border border-border-subtle p-3 rounded text-center">
                <div className="text-text-secondary mb-1">PLAYSTYLE</div>
                <div className="text-zync-cyan">AGGRESSIVE</div>
              </div>
              <div className="bg-bg-secondary border border-border-subtle p-3 rounded text-center">
                <div className="text-text-secondary mb-1">MATCH</div>
                <div className="text-white">87%</div>
              </div>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="bg-bg-card border border-border-subtle p-8 rounded-xl hover:border-border-subtle/80 transition-colors relative group overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
              <div className="text-6xl font-black text-zync-cyan">03</div>
            </div>
            <h3 className="text-sm font-bold tracking-widest text-zync-cyan mb-6 uppercase">Build Your Squad</h3>
            <p className="text-text-secondary text-sm leading-relaxed mb-6">
              Connect with highly compatible players based on accurate data. Create strong connections and build a consistent team roster for competitive tournaments.
            </p>
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-text-primary">
              <span className="w-1.5 h-1.5 bg-zync-cyan rounded-full"></span>
              ROSTER MANAGEMENT
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default Landing;
