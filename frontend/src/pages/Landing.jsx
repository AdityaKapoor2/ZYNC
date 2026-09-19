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
          <Link to="/login" className="text-sm font-bold tracking-wide text-bg-primary bg-white hover:bg-gray-200 transition-colors px-6 py-2.5 rounded-md">
            Sign In
          </Link>
        </div>
      </nav>

      <main className="container mx-auto px-6 pt-16 pb-32 relative z-10">
        <div className="max-w-4xl mx-auto text-center">


          <h1 className="text-5xl md:text-7xl font-extrabold mb-6 tracking-tight">
            Find teammates who <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-purple via-zync-blue to-zync-cyan">
              actually match your style.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-text-secondary mb-12 max-w-2xl mx-auto leading-relaxed">
            Stop relying on random matchmaking. ZYNC structures and evaluates compatibility across skill, roles, and competitive goals to find the perfect squad.
          </p>

          <Link to="/login" className="inline-flex items-center justify-center px-8 py-4 rounded-md font-bold text-base bg-gradient-to-r from-zync-blue to-zync-purple hover:brightness-110 transition-all shadow-lg hover:shadow-xl text-white">
            Find Your Squad
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mt-32">

          {/* Feature 1 */}
          <div className="bg-[#141A2B]/70 border border-zync-blue/50 p-8 rounded-xl hover:border-zync-blue/80 transition-colors flex flex-col items-center text-center shadow-lg">
            <div className="w-12 h-12 flex items-center justify-center border border-border-subtle bg-[#080B14] rounded-lg mb-6 text-zync-blue font-bold text-lg">
              01
            </div>
            <h3 className="text-lg font-bold text-white mb-3">PLAY YOUR GAMES</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Find teammates across BGMI, Valorant and Brawl Stars.
            </p>
          </div>

          {/* Feature 2 */}
          <div className="bg-[#141A2B]/70 border border-zync-purple/50 p-8 rounded-xl hover:border-zync-purple/80 transition-colors flex flex-col items-center text-center shadow-lg">
            <div className="w-12 h-12 flex items-center justify-center border border-border-subtle bg-[#080B14] rounded-lg mb-6 text-zync-purple font-bold text-lg">
              02
            </div>
            <h3 className="text-lg font-bold text-white mb-3">MATCH SMARTER</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Compatibility based on skill, role, availability and playstyle.
            </p>
          </div>

          {/* Feature 3 */}
          <div className="bg-[#141A2B]/70 border border-zync-cyan/50 p-8 rounded-xl hover:border-zync-cyan/80 transition-colors flex flex-col items-center text-center shadow-lg">
            <div className="w-12 h-12 flex items-center justify-center border border-border-subtle bg-[#080B14] rounded-lg mb-6 text-zync-cyan font-bold text-lg">
              03
            </div>
            <h3 className="text-lg font-bold text-white mb-3">BUILD YOUR SQUAD</h3>
            <p className="text-text-secondary text-sm leading-relaxed">
              Connect with compatible players and turn good matches into lasting teams.
            </p>
          </div>

        </div>
      </main>
    </div>
  );
};

export default Landing;
