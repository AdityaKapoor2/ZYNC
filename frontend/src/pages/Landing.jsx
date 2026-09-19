import React from 'react';
import { Link } from 'react-router-dom';

import zyncLogo from '../assets/zync-logo.png';
import landingBg from '../assets/landing.png';
import bgmiLogo from '../assets/bgmi.jpg';
import valorantLogo from '../assets/valorant.png';
import brawlStarsLogo from '../assets/brawl-stars.png';
import avatar1 from '../assets/match-avatar-1.jpg';
import avatar2 from '../assets/match-avatar-2.jpg';

const Landing = () => {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary selection:bg-zync-purple/30 font-sans relative overflow-hidden">

      {/* Hero Background Image */}
      <div className="absolute inset-0 w-full h-full pointer-events-none z-0">
        <img
          src={landingBg}
          alt="ZYNC Esports"
          className="w-full h-full object-cover object-center opacity-40 md:opacity-50 blur-[2px]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-bg-primary/50 via-bg-primary/80 to-bg-primary"></div>
      </div>

      {/* Subtle ambient background glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] max-w-[100vw] h-[400px] bg-zync-blue/10 blur-[120px] rounded-full pointer-events-none -z-10"></div>

      <nav className="container mx-auto px-4 md:px-6 py-4 md:py-6 flex justify-between items-center relative z-10 border-b border-border-subtle/30 mb-8">
        <div className="flex items-center gap-3">
          <img src={zyncLogo} alt="ZYNC Logo" className="w-8 h-8 md:w-10 md:h-10 object-contain" />
          <span className="text-lg md:text-xl font-bold tracking-widest text-text-primary">
            ZYNC
          </span>
        </div>
        <div>
          <Link to="/login" className="text-sm font-bold tracking-wide text-bg-primary bg-white hover:bg-gray-200 transition-colors px-4 md:px-6 py-2 md:py-2.5 rounded-md">
            Sign In
          </Link>
        </div>
      </nav>

      <main className="container mx-auto px-4 md:px-6 pt-10 md:pt-16 pb-20 md:pb-32 relative z-10">
        <div className="max-w-4xl mx-auto text-center">


          <h1
            className="text-4xl sm:text-5xl md:text-7xl font-extrabold mb-4 md:mb-6 tracking-tight break-words"
            style={{ WebkitTextStroke: '1px #000000' }}
          >
            Find teammates who <br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-zync-purple via-zync-blue to-zync-cyan">
              actually match your style.
            </span>
          </h1>

          <p className="text-base md:text-xl text-text-secondary mb-8 md:mb-12 max-w-2xl mx-auto leading-relaxed">
            Stop relying on random matchmaking. ZYNC structures and evaluates compatibility across skill, roles, and competitive goals to find the perfect squad.
          </p>

          <Link to="/login" className="flex sm:inline-flex items-center justify-center w-full sm:w-auto px-6 md:px-8 py-3.5 md:py-4 rounded-md font-bold text-sm md:text-base bg-gradient-to-r from-zync-blue to-zync-purple hover:brightness-110 transition-all shadow-lg hover:shadow-xl text-white">
            Find Your Squad
          </Link>
        </div>

        <div className="mt-16 md:mt-24 text-center relative z-10">
          <h2 className="text-xl md:text-2xl font-bold text-white mb-1 uppercase tracking-wider">How it works</h2>
          <p className="text-text-secondary text-sm md:text-base">From solo queue to squad in 3 steps.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mt-8 md:mt-12 relative z-10">
          
          {/* Desktop Connector Line */}
          <div className="hidden md:block absolute top-[2.25rem] left-[16.6%] right-[16.6%] border-t border-dashed border-white/15 -z-10"></div>

          {/* Feature 1 */}
          <div className="group relative bg-[#0A0F1E]/40 backdrop-blur-md border border-white/5 hover:border-zync-blue/30 p-5 md:p-6 rounded-xl hover:-translate-y-1 transition-all duration-200 flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_30px_rgba(59,130,246,0.15)]">
            <div className="flex items-center justify-between w-full mb-4">
              <span className="text-[10px] font-bold text-zync-blue bg-zync-blue/10 border border-zync-blue/20 px-2 py-0.5 rounded tracking-widest shadow-[0_0_10px_rgba(59,130,246,0.15)]">01</span>
            </div>
            
            <h3 className="text-lg font-bold text-white mb-2 tracking-wide uppercase">FIND YOUR GAME</h3>
            <p className="text-white/80 text-[15px] leading-relaxed mb-6">
              Pick your games, rank and role. Takes under a minute.
            </p>
            
            <div className="mt-auto flex flex-wrap gap-2 items-center justify-center bg-white/5 border border-white/10 p-2.5 rounded-lg">
              <div className="flex items-center gap-2 bg-black/40 px-2.5 py-1.5 rounded border border-white/5">
                <img src={bgmiLogo} alt="BGMI" className="w-6 h-6 rounded object-cover" />
                <span className="text-xs font-bold text-white/90 uppercase">BGMI</span>
              </div>
              <div className="flex items-center gap-2 bg-black/40 px-2.5 py-1.5 rounded border border-white/5">
                <img src={valorantLogo} alt="Valorant" className="w-6 h-6 rounded object-cover" />
                <span className="text-xs font-bold text-white/90 uppercase">VALORANT</span>
              </div>
              <div className="flex items-center gap-2 bg-black/40 px-2.5 py-1.5 rounded border border-white/5">
                <img src={brawlStarsLogo} alt="Brawl Stars" className="w-6 h-6 rounded object-cover" />
                <span className="text-xs font-bold text-white/90 uppercase">BRAWL</span>
              </div>
            </div>
          </div>

          {/* Feature 2 */}
          <div className="group relative bg-[#0A0F1E]/40 backdrop-blur-md border border-white/5 hover:border-zync-purple/30 p-5 md:p-6 rounded-xl hover:-translate-y-1 transition-all duration-200 flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_30px_rgba(168,85,247,0.15)]">
            <div className="flex items-center justify-between w-full mb-4">
              <span className="text-[10px] font-bold text-zync-purple bg-zync-purple/10 border border-zync-purple/20 px-2 py-0.5 rounded tracking-widest shadow-[0_0_10px_rgba(168,85,247,0.15)]">02</span>
            </div>
            
            <h3 className="text-lg font-bold text-white mb-2 tracking-wide uppercase">FIND YOUR MATCH</h3>
            <p className="text-white/80 text-[15px] leading-relaxed mb-6">
              We match on role, skill, schedule and playstyle, not just rank.
            </p>
            
            <div className="mt-auto bg-black/40 border border-white/10 p-2.5 rounded-lg flex items-center gap-3 relative overflow-hidden group-hover:border-zync-purple/20 transition-colors">
              <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-zync-purple/10 to-transparent pointer-events-none"></div>
              <img src={avatar1} alt="Match" className="w-9 h-9 rounded-full border border-zync-purple/40 object-cover" />
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-zync-purple tracking-wider mb-0.5">92% MATCH</span>
                <span className="text-[10px] text-white/70">Duelist &middot; Diamond &middot; Evenings</span>
              </div>
            </div>
          </div>

          {/* Feature 3 */}
          <div className="group relative bg-[#0A0F1E]/40 backdrop-blur-md border border-white/5 hover:border-zync-cyan/30 p-5 md:p-6 rounded-xl hover:-translate-y-1 transition-all duration-200 flex flex-col shadow-[0_4px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_8px_30px_rgba(6,182,212,0.15)]">
            <div className="flex items-center justify-between w-full mb-4">
              <span className="text-[10px] font-bold text-zync-cyan bg-zync-cyan/10 border border-zync-cyan/20 px-2 py-0.5 rounded tracking-widest shadow-[0_0_10px_rgba(6,182,212,0.15)]">03</span>
            </div>
            
            <h3 className="text-lg font-bold text-white mb-2 tracking-wide uppercase">BUILD YOUR SQUAD</h3>
            <p className="text-white/80 text-[15px] leading-relaxed mb-6">
              Team up, hop on voice, and keep the squad that clicks.
            </p>
            
            <div className="mt-auto flex items-center justify-between bg-black/40 border border-white/10 p-2.5 rounded-lg group-hover:border-zync-cyan/20 transition-colors">
              <div className="flex -space-x-2">
                <img src={avatar1} alt="Avatar 1" className="w-9 h-9 rounded-full border-2 border-[#141A2B] object-cover relative z-20" />
                <img src={avatar2} alt="Avatar 2" className="w-9 h-9 rounded-full border-2 border-[#141A2B] object-cover relative z-10" />
                <div className="w-9 h-9 rounded-full border-2 border-[#141A2B] bg-[#0A0F1E] flex items-center justify-center relative z-0">
                  <span className="text-[10px] font-bold text-white/50">+2</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1 bg-zync-cyan/10 border border-zync-cyan/20 rounded-md">
                <div className="w-1.5 h-1.5 rounded-full bg-zync-cyan"></div>
                <span className="text-[10px] font-bold text-zync-cyan uppercase">Squad ready</span>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default Landing;
