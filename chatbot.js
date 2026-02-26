// ── OxyTrace AI Chatbot (Gemini) ──────────────────────────────────────────────
(function () {
  const GEMINI_API_KEY = window.GEMINI_API_KEY || '3c6018c1a469453181efdaa8bae424b0.dfiQs62RCvC5ZeFM';
  const MODEL = 'gemini-2.0-flash';
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const SYSTEM_PROMPT = `You are OxyBot, a smart assistant built into the OxyTrace air quality app.
You help users with:
- Air quality & health: Explain AQI levels, PM2.5, pollutants, and health risks
- Navigation: Help users find safe parks, low-pollution routes, and safe zones
- Alerts: Warn users about dangerous air quality and advise precautions
- Tips: Give personalized advice on masks, outdoor timing, indoor air quality

Always be concise, friendly, and focused on air quality and health topics.
If asked something unrelated, gently redirect to OxyTrace topics.`;

  // System prompt is injected as the opening exchange in history
  // (more compatible than top-level system_instruction across all API key tiers)
  let history = [
    { role: 'user',  parts: [{ text: SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: "Understood! I'm OxyBot, your OxyTrace air quality assistant. I'm ready to help with AQI info, health tips, safe navigation, and pollution alerts." }] }
  ];

  let isOpen = false;

  // ── Styles ────────────────────────────────────────────────────────────────────
  const styles = `
    #oxy-bubble {
      position: fixed; bottom: 90px; right: 20px; z-index: 10000;
      width: 52px; height: 52px; border-radius: 50%;
      background: linear-gradient(135deg, #00d4ff, #00ff88);
      box-shadow: 0 0 20px rgba(0,212,255,0.6), 0 0 40px rgba(0,255,136,0.2);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      font-size: 22px; transition: transform 0.2s, box-shadow 0.2s;
      animation: pulse-bubble 3s ease-in-out infinite;
    }
    #oxy-bubble:hover { transform: scale(1.1); box-shadow: 0 0 30px rgba(0,212,255,0.9); }
    @keyframes pulse-bubble {
      0%,100% { box-shadow: 0 0 20px rgba(0,212,255,0.6); }
      50% { box-shadow: 0 0 35px rgba(0,212,255,0.9), 0 0 60px rgba(0,255,136,0.3); }
    }
    #oxy-window {
      position: fixed; bottom: 155px; right: 20px; z-index: 10000;
      width: 340px; max-height: 520px;
      background: #070b0f; border: 1px solid rgba(0,212,255,0.3);
      border-radius: 16px; display: flex; flex-direction: column;
      box-shadow: 0 0 40px rgba(0,212,255,0.15), 0 20px 60px rgba(0,0,0,0.6);
      font-family: 'IBM Plex Mono', monospace;
      transition: opacity 0.2s, transform 0.2s;
    }
    #oxy-window.hidden { opacity: 0; pointer-events: none; transform: translateY(10px); }
    #oxy-header {
      padding: 14px 16px; border-bottom: 1px solid rgba(0,212,255,0.15);
      display: flex; align-items: center; justify-content: space-between;
      background: rgba(0,212,255,0.05); border-radius: 16px 16px 0 0;
    }
    #oxy-header-left { display: flex; align-items: center; gap: 10px; }
    #oxy-avatar {
      width: 34px; height: 34px; border-radius: 50%;
      background: linear-gradient(135deg,#00d4ff,#00ff88);
      display: flex; align-items:center; justify-content:center; font-size:16px;
    }
    #oxy-title { color: #00d4ff; font-size: 13px; font-weight: 600; letter-spacing:1px; }
    #oxy-subtitle { color: rgba(0,212,255,0.5); font-size: 10px; }
    #oxy-close { color: rgba(0,212,255,0.5); cursor:pointer; font-size:18px; padding:4px; }
    #oxy-close:hover { color: #00d4ff; }
    #oxy-messages {
      flex: 1; overflow-y: auto; padding: 14px; display: flex;
      flex-direction: column; gap: 10px; min-height: 0; max-height: 360px;
    }
    #oxy-messages::-webkit-scrollbar { width: 4px; }
    #oxy-messages::-webkit-scrollbar-thumb { background: rgba(0,212,255,0.3); border-radius:4px; }
    .oxy-msg {
      max-width: 85%; padding: 10px 13px; border-radius: 12px;
      font-size: 12px; line-height: 1.55; word-break: break-word; white-space: pre-wrap;
    }
    .oxy-msg.bot {
      background: rgba(0,212,255,0.08); border: 1px solid rgba(0,212,255,0.15);
      color: #c8eeff; align-self: flex-start; border-radius: 4px 12px 12px 12px;
    }
    .oxy-msg.user {
      background: rgba(0,255,136,0.1); border: 1px solid rgba(0,255,136,0.2);
      color: #b8ffd8; align-self: flex-end; border-radius: 12px 4px 12px 12px;
    }
    .oxy-msg.error {
      background: rgba(255,80,80,0.08); border: 1px solid rgba(255,80,80,0.25);
      color: #ffaaaa; align-self: flex-start; border-radius: 4px 12px 12px 12px;
    }
    .oxy-typing { display:flex; gap:5px; align-items:center; padding:4px 0; }
    .oxy-typing span {
      width:6px; height:6px; border-radius:50%; background:#00d4ff; opacity:0.4;
      animation: typingDot 1.2s infinite;
    }
    .oxy-typing span:nth-child(2){animation-delay:.2s;}
    .oxy-typing span:nth-child(3){animation-delay:.4s;}
    @keyframes typingDot { 0%,80%,100%{opacity:0.2;transform:scale(1);} 40%{opacity:1;transform:scale(1.2);} }
    #oxy-input-area {
      padding: 12px; border-top: 1px solid rgba(0,212,255,0.12);
      display: flex; gap: 8px; align-items: flex-end;
    }
    #oxy-input {
      flex:1; background: rgba(0,212,255,0.05); border: 1px solid rgba(0,212,255,0.2);
      border-radius: 10px; padding: 9px 12px; color: #e0f4ff;
      font-family: 'IBM Plex Mono', monospace; font-size: 12px;
      resize: none; outline: none; max-height: 80px;
    }
    #oxy-input:focus { border-color: rgba(0,212,255,0.5); }
    #oxy-input::placeholder { color: rgba(0,212,255,0.3); }
    #oxy-send {
      width: 36px; height: 36px; border-radius: 50%; flex-shrink:0;
      background: linear-gradient(135deg,#00d4ff,#00ff88);
      border: none; cursor: pointer; display:flex; align-items:center; justify-content:center;
      font-size: 15px; transition: transform 0.15s, box-shadow 0.15s;
    }
    #oxy-send:hover { transform:scale(1.1); box-shadow: 0 0 15px rgba(0,212,255,0.5); }
    #oxy-send:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .oxy-quick-btns { display:flex; flex-wrap:wrap; gap:6px; padding: 0 14px 10px; }
    .oxy-quick {
      font-size:10px; padding:5px 10px; border-radius:20px; cursor:pointer;
      border: 1px solid rgba(0,212,255,0.3); color: #00d4ff;
      background: rgba(0,212,255,0.05); transition: background 0.2s;
      font-family: 'IBM Plex Mono', monospace;
    }
    .oxy-quick:hover { background: rgba(0,212,255,0.15); }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  document.head.appendChild(styleEl);

  document.body.insertAdjacentHTML('beforeend', `
    <div id="oxy-bubble" title="OxyBot — AI Assistant">🤖</div>
    <div id="oxy-window" class="hidden">
      <div id="oxy-header">
        <div id="oxy-header-left">
          <div id="oxy-avatar">🌿</div>
          <div>
            <div id="oxy-title">OxyBot</div>
            <div id="oxy-subtitle">Air Quality Assistant</div>
          </div>
        </div>
        <span id="oxy-close">✕</span>
      </div>
      <div id="oxy-messages"></div>
      <div class="oxy-quick-btns">
        <button class="oxy-quick" data-q="What does AQI mean?">What is AQI?</button>
        <button class="oxy-quick" data-q="Is it safe to go outside today?">Safe outside?</button>
        <button class="oxy-quick" data-q="Find me a safe park nearby">Safe park</button>
        <button class="oxy-quick" data-q="What mask should I wear for bad air?">Mask tips</button>
      </div>
      <div id="oxy-input-area">
        <textarea id="oxy-input" rows="1" placeholder="Ask about air quality, health, alerts…"></textarea>
        <button id="oxy-send">➤</button>
      </div>
    </div>
  `);

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const bubble = document.getElementById('oxy-bubble');
  const win    = document.getElementById('oxy-window');
  const msgs   = document.getElementById('oxy-messages');
  const input  = document.getElementById('oxy-input');
  const send   = document.getElementById('oxy-send');

  // ── Toggle ────────────────────────────────────────────────────────────────────
  function toggleChat() {
    isOpen = !isOpen;
    win.classList.toggle('hidden', !isOpen);
    if (isOpen && msgs.children.length === 0) {
      addMsg("bot", "👋 Hey! I'm OxyBot, your OxyTrace AI assistant.\n\nAsk me about AQI levels, health tips, safe parks, or pollution alerts!");
    }
  }

  bubble.addEventListener('click', toggleChat);
  document.getElementById('oxy-close').addEventListener('click', toggleChat);

  document.querySelectorAll('.oxy-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      input.value = btn.dataset.q;
      sendMessage();
    });
  });

  // ── Message helpers ───────────────────────────────────────────────────────────
  function addMsg(type, text) {
    const div = document.createElement('div');
    div.className = `oxy-msg ${type}`;
    // Strip markdown bold/italic for cleaner display
    div.textContent = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1');
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'oxy-msg bot';
    div.id = 'oxy-typing';
    div.innerHTML = '<div class="oxy-typing"><span></span><span></span><span></span></div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    const t = document.getElementById('oxy-typing');
    if (t) t.remove();
  }

  // ── Send ──────────────────────────────────────────────────────────────────────
  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    send.disabled = true;

    addMsg('user', text);
    showTyping();

    history.push({ role: 'user', parts: [{ text }] });

    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: history })
      });

      const data = await res.json();
      removeTyping();

      // Log full response to console for debugging
      console.log('[OxyBot] API response:', data);

      if (!res.ok) {
        // Show the actual API error message
        const errMsg = data?.error?.message || `API error ${res.status}`;
        console.error('[OxyBot] API error:', errMsg);
        addMsg('error', `⚠️ API Error: ${errMsg}`);
        history.pop(); // Remove the failed message from history
      } else {
        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply) {
          history.push({ role: 'model', parts: [{ text: reply }] });
          addMsg('bot', reply);
        } else {
          console.warn('[OxyBot] Unexpected response shape:', data);
          addMsg('error', '⚠️ Got an empty response. Please try again.');
          history.pop();
        }
      }
    } catch (err) {
      removeTyping();
      console.error('[OxyBot] Network/fetch error:', err);
      addMsg('error', `⚠️ Network error: ${err.message}`);
      history.pop();
    }

    send.disabled = false;
    input.focus();
  }

  send.addEventListener('click', sendMessage);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 80) + 'px';
  });
})();
