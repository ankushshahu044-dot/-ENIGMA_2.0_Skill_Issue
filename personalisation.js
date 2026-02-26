/**
 * personalization.js — Adaptive UI Mutator
 * ─────────────────────────────────────────────────────────────────────────────
 * Modifies the HTML structure based on the user's disease profile.
 */

function applyAdaptiveUI() {
    const profile = JSON.parse(localStorage.getItem('oxtrace_health_profile') || '{}');
    const conditions = (profile.conditions || []).map(c => c.toLowerCase());
    
    console.log("OxyTrace AI: Adapting Interface for", conditions);

    const mainContainer = document.querySelector('main');

    // ─── SCENARIO 1: ASTHMA MODE ─────────────────────────────────────────────
    if (conditions.includes('asthma')) {
        // 1. Inject "Inhaler Tracker" right after the Map
        const trackerHTML = `
            <section class="mb-4 fade-up">
                <div class="stat-card rounded-2xl p-4 border border-cyan-500/30 flex justify-between items-center bg-cyan-900/10">
                    <div>
                        <h3 class="font-orbitron text-sm text-cyan-400">INHALER LOG</h3>
                        <p class="text-[10px] opacity-60">Track your puffs today</p>
                    </div>
                    <button onclick="this.innerHTML='LOGGED ✓'; this.style.background='#00d4ff'; this.style.color='black'" 
                        class="px-4 py-2 rounded-lg border border-cyan-500 text-cyan-400 font-orbitron text-xs hover:bg-cyan-500 hover:text-black transition-all">
                        + PUFF
                    </button>
                </div>
            </section>
        `;
        // Find the map section and insert this after it
        const mapSection = document.querySelector('iframe').closest('section');
        mapSection.insertAdjacentHTML('afterend', trackerHTML);
    }

    // ─── SCENARIO 2: COPD MODE ───────────────────────────────────────────────
    if (conditions.includes('copd')) {
        // 1. Move Oxygen (O2) Card to the very top (Priority #1)
        // We find the O2 card by its text content
        const allCards = document.querySelectorAll('.stat-card');
        allCards.forEach(card => {
            if (card.innerText.includes('O₂')) {
                // Clone it, style it as "Critical", and put it at the top
                const heroO2 = card.cloneNode(true);
                heroO2.style.borderColor = '#ff4444';
                heroO2.style.background = 'rgba(255, 68, 68, 0.1)';
                heroO2.innerHTML += `<div class="text-[10px] text-red-400 mt-1 text-center font-bold">MONITORING REQUIRED</div>`;
                
                const locationBar = document.querySelector('main > div'); // The location bar
                locationBar.insertAdjacentElement('afterend', heroO2);
            }
        });
    }
}

// Run immediately after page load
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(applyAdaptiveUI, 500); // Wait 500ms for main layout to settle
});
