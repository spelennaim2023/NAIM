
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, LiveServerMessage, Type } from '@google/genai';

// --- CONFIG & THEMES ---
const MODEL_NAME = 'gemini-2.5-flash-native-audio-preview-12-2025';
const VERSION = 'v4.4';
const FRAME_RATE = 1; 

type ThemeColor = 'emerald' | 'cyan' | 'violet' | 'rose' | 'amber' | 'slate' | 'disco';
type Environment = 'aurora' | 'space' | 'matrix' | 'void';

const THEMES: Record<Exclude<ThemeColor, 'disco'>, { hex: string, bg: string, glow: string }> = {
  emerald: { hex: '#10b981', bg: 'from-emerald-400 to-emerald-700', glow: 'rgba(16, 185, 129, 0.4)' },
  cyan: { hex: '#06b6d4', bg: 'from-cyan-400 to-cyan-600', glow: 'rgba(6, 182, 212, 0.4)' },
  violet: { hex: '#8b5cf6', bg: 'from-violet-400 to-violet-700', glow: 'rgba(139, 92, 246, 0.4)' },
  rose: { hex: '#f43f5e', bg: 'from-rose-400 to-rose-600', glow: 'rgba(244, 63, 94, 0.4)' },
  amber: { hex: '#f59e0b', bg: 'from-amber-400 to-amber-600', glow: 'rgba(245, 158, 11, 0.4)' },
  slate: { hex: '#475569', bg: 'from-slate-700 to-slate-900', glow: 'rgba(71, 85, 105, 0.2)' },
};

const THEME_KEYS = Object.keys(THEMES) as Array<Exclude<ThemeColor, 'disco'>>;

// --- UTILS ---
const decode = (base64: string) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

const encode = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const decodeAudioData = async (data: Uint8Array, ctx: AudioContext) => {
  const dataInt16 = new Int16Array(data.buffer);
  const buffer = ctx.createBuffer(1, dataInt16.length, 24000);
  const channelData = buffer.getChannelData(0);
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }
  return buffer;
};

const createBlob = (data: Float32Array) => {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    int16[i] = data[i] * 32768;
  }
  return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
};

// --- VISUAL COMPONENTS ---

const ParticleBackground = ({ color }: { color: string }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: any[] = [];
    for (let i = 0; i < 50; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 1,
        speedX: (Math.random() - 0.5) * 0.5,
        speedY: (Math.random() - 0.5) * 0.5,
        alpha: Math.random() * 0.5
      });
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.speedX;
        p.y += p.speedY;
        if (p.x < 0 || p.x > canvas.width) p.speedX *= -1;
        if (p.y < 0 || p.y > canvas.height) p.speedY *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = p.alpha;
        ctx.fill();
      });
      requestAnimationFrame(animate);
    };

    animate();
  }, [color]);

  return <canvas ref={canvasRef} className="fixed inset-0 z-[-1] pointer-events-none opacity-40" />;
};

const MatrixBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$#@&%*';
    const fontSize = 14;
    const columns = canvas.width / fontSize;
    const drops = Array(Math.floor(columns)).fill(1);
    const draw = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0F0';
      ctx.font = `${fontSize}px monospace`;
      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }
    };
    const interval = setInterval(draw, 33);
    return () => clearInterval(interval);
  }, []);
  return <canvas ref={canvasRef} className="fixed inset-0 z-[-1] opacity-30" />;
};

const NAIMCharacter = ({ 
  isSpeaking, isListening, isSleeping, volume, inputVolume, themeColor, discoColor, multiplicity, id, scaleFactor, isGhost, isHologram, timeDilation, mood 
}: { 
  isSpeaking: boolean, isListening: boolean, isSleeping: boolean, volume: number, inputVolume: number, 
  themeColor: ThemeColor, discoColor: Exclude<ThemeColor, 'disco'>, multiplicity: number, id: number, 
  scaleFactor: number, isGhost: boolean, isHologram: boolean, timeDilation: number, mood: string
}) => {
  const activeColorKey = themeColor === 'disco' ? discoColor : themeColor;
  const activeTheme = isSleeping ? THEMES['slate'] : THEMES[activeColorKey];
  const [pulse, setPulse] = useState(0);
  const [isBlinking, setIsBlinking] = useState(false);

  useEffect(() => {
    let animId: number;
    const animate = (time: number) => {
      const offset = id * 700;
      const speed = (isSleeping ? 2500 : (themeColor === 'disco' ? 300 : 700)) / timeDilation;
      setPulse(Math.sin((time + offset) / speed) * (isSleeping ? 2 : (themeColor === 'disco' ? 20 : 6)));
      animId = requestAnimationFrame(animate);
    };
    animate(0);
    return () => cancelAnimationFrame(animId);
  }, [isSleeping, themeColor, id, timeDilation]);

  useEffect(() => {
    if (isSleeping) return;
    const blink = () => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 120 / timeDilation);
      setTimeout(blink, (1500 + Math.random() * 6000) / timeDilation);
    };
    const timeoutId = setTimeout(blink, 2000 + (id * 500));
    return () => clearTimeout(timeoutId);
  }, [isSleeping, id, timeDilation]);

  const activeVolume = isSpeaking ? volume : (isListening ? inputVolume * 0.4 : 0);
  const countFactor = multiplicity > 3 ? 0.45 : (multiplicity > 1 ? 0.65 : 0.85);
  const baseScale = (isSleeping ? 0.65 : (themeColor === 'disco' ? 1.1 : 1)) * countFactor * scaleFactor;
  const scale = baseScale + (pulse / 80) + (activeVolume * 0.5);
  const bodySize = multiplicity > 3 ? 'w-48 h-48' : (multiplicity > 1 ? 'w-64 h-64' : 'w-80 h-80');

  // EMOTIONAL EYE RENDERING
  const renderEye = (side: 'L' | 'R') => {
    if (isSleeping || isBlinking) return <div className="w-[15%] h-[2%] bg-black/40 rounded-full transition-all duration-300" />;

    let eyeStyle = "w-[15%] h-[25%] bg-white rounded-full flex items-center justify-center transition-all duration-500 overflow-hidden shadow-[0_0_30px_rgba(255,255,255,0.2)]";
    let pupilStyle = "w-1/2 h-1/2 bg-black rounded-full transition-all duration-75";

    if (mood === 'angry') {
      eyeStyle += side === 'L' ? ' rotate-[20deg]' : ' rotate-[-20deg]';
      pupilStyle += ' scale-[1.3]';
    } else if (mood === 'happy') {
      eyeStyle += ' scale-y-[0.8]';
      pupilStyle += ' translate-y-[-2px]';
    } else if (mood === 'curious') {
      eyeStyle += side === 'L' ? ' scale-[1.1]' : ' scale-[0.9]';
    } else if (mood === 'excited') {
      eyeStyle += ' scale-[1.2]';
      pupilStyle += ' scale-[0.6]';
    }

    return (
      <div className={eyeStyle}>
        <div 
          className={pupilStyle}
          style={{ transform: `translateY(${isSpeaking ? volume * -30 : 0}px) scale(${1 + activeVolume})` }}
        >
          <div className="w-1/3 h-1/3 bg-white rounded-full translate-x-1/2 translate-y-1/2 opacity-80" />
        </div>
      </div>
    );
  };
  
  return (
    <div 
      className={`relative flex flex-col items-center justify-center transition-all duration-1000 ${isSleeping ? 'opacity-40 translate-y-12' : 'opacity-100 animate-float'} ${isHologram ? 'animate-hologram-flicker' : ''}`} 
      style={{ 
        opacity: isGhost ? 0.25 : 1,
        animationDuration: `${7 / timeDilation}s`,
        filter: isHologram ? 'drop-shadow(0 0 10px rgba(0,255,255,0.5))' : 'none'
      }}
    >
      <div 
        className="absolute w-[400px] h-[400px] rounded-full blur-[120px] transition-all duration-1000 mix-blend-screen"
        style={{ 
            backgroundColor: activeTheme.hex, 
            opacity: isSleeping ? 0.03 : (themeColor === 'disco' ? 0.5 : 0.25),
            transform: `scale(${scaleFactor * 1.2})`
        }}
      />
      
      <div className="blob-filter">
        <div 
          className={`relative ${bodySize} bg-gradient-to-br ${activeTheme.bg} rounded-[45%] transition-all duration-700 shadow-[inset_-30px_-30px_80px_rgba(0,0,0,0.6)] overflow-visible`}
          style={{ 
            transform: `scale(${scale})`,
            borderRadius: isSpeaking ? '38% 62% 62% 38% / 30% 30% 70% 70%' : (isListening && inputVolume > 0.05 ? '46% 46% 54% 54%' : '50%'),
            boxShadow: `0 0 ${isSleeping ? 5 : (80 + activeVolume * 200)}px ${activeTheme.glow}`,
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center gap-[18%] -translate-y-10">
            {renderEye('L')}
            {renderEye('R')}
          </div>

          <div className="absolute bottom-[22%] left-1/2 -translate-x-1/2 w-[35%] h-[20%] flex items-center justify-center">
             <div 
                className="bg-black/95 rounded-full transition-all duration-75"
                style={{ 
                  width: isSpeaking ? `${25 + volume * 85}%` : (isListening && inputVolume > 0.05 ? '15%' : '8%'),
                  height: isSpeaking ? `${5 + volume * 100}%` : (isListening && inputVolume > 0.05 ? '2%' : '4%'),
                  opacity: isSleeping ? 0.02 : 0.98,
                  transform: `translateY(${mood === 'happy' ? '-5px' : '0px'})`
                }}
             />
          </div>
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [isActive, setIsActive] = useState(false);
  const [isSleeping, setIsSleeping] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [volume, setVolume] = useState(0);
  const [inputVolume, setInputVolume] = useState(0);
  const [themeColor, setThemeColor] = useState<ThemeColor>('emerald');
  const [discoColor, setDiscoColor] = useState<Exclude<ThemeColor, 'disco'>>('emerald');
  const [environment, setEnvironment] = useState<Environment>('aurora');
  const [mood, setMood] = useState('happy');
  const [isGlitching, setIsGlitching] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isGhost, setIsGhost] = useState(false);
  const [isHologram, setIsHologram] = useState(false);
  const [timeDilation, setTimeDilation] = useState(1);
  const [showCode, setShowCode] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [scaleFactor, setScaleFactor] = useState(1);
  const [multiplicity, setMultiplicity] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const audioCtxRef = useRef<{ input: AudioContext | null, output: AudioContext | null }>({ input: null, output: null });
  const streamRef = useRef<MediaStream | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<any>(null);

  useEffect(() => {
    if (themeColor !== 'disco') return;
    const interval = setInterval(() => {
      setDiscoColor(THEME_KEYS[Math.floor(Math.random() * THEME_KEYS.length)]);
    }, 300);
    return () => clearInterval(interval);
  }, [themeColor]);

  const toggleCamera = async (forceState?: boolean) => {
    const newState = forceState !== undefined ? forceState : !isCameraActive;
    if (newState) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        videoStreamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      } catch (e) { console.error(e); }
    } else {
      if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setIsCameraActive(false);
    }
  };

  useEffect(() => {
    let interval: number;
    if (isActive && isCameraActive) {
      interval = window.setInterval(() => {
        if (!videoRef.current || !canvasRef.current || !sessionRef.current) return;
        const ctx = canvasRef.current.getContext('2d');
        if (!ctx) return;
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        ctx.drawImage(videoRef.current, 0, 0);
        canvasRef.current.toBlob((blob) => {
          if (blob) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              sessionRef.current?.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
            };
            reader.readAsDataURL(blob);
          }
        }, 'image/jpeg', 0.5);
      }, 1000 / FRAME_RATE);
    }
    return () => clearInterval(interval);
  }, [isActive, isCameraActive]);

  const cleanup = useCallback(() => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (videoStreamRef.current) videoStreamRef.current.getTracks().forEach(t => t.stop());
    if (audioCtxRef.current.input?.state !== 'closed') audioCtxRef.current.input?.close().catch(()=>{});
    if (audioCtxRef.current.output?.state !== 'closed') audioCtxRef.current.output?.close().catch(()=>{});
    sourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
    sourcesRef.current.clear();
    setIsActive(false); setIsSleeping(true); setIsSpeaking(false); setIsListening(false);
    setThemeColor('emerald'); setIsGlitching(false); setScaleFactor(1); setMultiplicity(1);
    setEnvironment('aurora'); setIsFlipped(false); setIsGhost(false); setIsHologram(false);
    setTimeDilation(1); setMood('happy');
  }, []);

  const startSession = async () => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      audioCtxRef.current = { input: inputCtx, output: outputCtx };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const micSource = inputCtx.createMediaStreamSource(stream);
      inputAnalyserRef.current = inputCtx.createAnalyser();
      micSource.connect(inputAnalyserRef.current);

      const functions = [
        { name: 'set_mood', parameters: { type: Type.OBJECT, properties: { mood: { type: Type.STRING, enum: ['happy', 'angry', 'curious', 'excited', 'cool', 'disco', 'relaxed'] } } } },
        { name: 'set_environment', parameters: { type: Type.OBJECT, properties: { env: { type: Type.STRING, enum: ['aurora', 'space', 'matrix', 'void'] } } } },
        { name: 'multiply_self', parameters: { type: Type.OBJECT, properties: { count: { type: Type.NUMBER } } } },
        { name: 'toggle_camera', parameters: { type: Type.OBJECT, properties: { active: { type: Type.BOOLEAN } } } },
        { name: 'set_ghost_mode', parameters: { type: Type.OBJECT, properties: { active: { type: Type.BOOLEAN } } } },
      ];

      const sessionPromise = ai.live.connect({
        model: MODEL_NAME,
        callbacks: {
          onopen: () => {
            setIsActive(true); setIsListening(true);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              sessionPromise.then(s => { sessionRef.current = s; s.sendRealtimeInput({ media: createBlob(e.inputBuffer.getChannelData(0)) }); });
            };
            micSource.connect(processor); processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (msg.toolCall) {
              for (const fc of msg.toolCall.functionCalls) {
                if (fc.name === 'set_mood') {
                  const map: any = { happy:'emerald', angry:'rose', curious:'violet', excited:'amber', cool:'cyan', disco:'disco', relaxed:'slate' };
                  setThemeColor(map[fc.args.mood as string] || 'emerald');
                  setMood(fc.args.mood as string);
                } else if (fc.name === 'set_environment') setEnvironment(fc.args.env as Environment);
                else if (fc.name === 'multiply_self') setMultiplicity(Math.max(1, Math.min(6, Number(fc.args.count))));
                else if (fc.name === 'toggle_camera') toggleCamera(!!fc.args.active);
                else if (fc.name === 'set_ghost_mode') setIsGhost(!!fc.args.active);
                sessionPromise.then(s => s.sendToolResponse({ functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } } }));
              }
            }
            if (msg.serverContent?.inputTranscription) {
              if (isSleeping && msg.serverContent.inputTranscription.text.toLowerCase().includes('naim')) setIsSleeping(false);
            }
            const base64 = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64) {
              setIsSpeaking(true); setIsSleeping(false);
              const buffer = await decodeAudioData(decode(base64), outputCtx);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              if (!outputAnalyserRef.current) outputAnalyserRef.current = outputCtx.createAnalyser();
              source.connect(outputAnalyserRef.current);
              outputAnalyserRef.current.connect(outputCtx.destination);
              source.onended = () => { sourcesRef.current.delete(source); if (sourcesRef.current.size === 0) setIsSpeaking(false); };
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
            if (msg.serverContent?.interrupted) { sourcesRef.current.forEach(s => s.stop()); sourcesRef.current.clear(); nextStartTimeRef.current = 0; setIsSpeaking(false); }
          },
          onerror: () => cleanup(),
          onclose: () => cleanup(),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          thinkingConfig: { thinkingBudget: 0 },
          tools: [{ functionDeclarations: functions }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } } },
          systemInstruction: `Je bent NAIM v4.4, de meest vloeibare AI ter wereld. Ontwikkeld door Naim Yavuz Çankaya (NCS).
          GEDRAG: Hyper-expressief. Toon emoties (happy, angry, curious, excited) via de 'set_mood' tool.
          Visuele feedback is key. Antwoord direct en vlijmscherp.`,
        }
      });
    } catch (e) { setError('Access Denied.'); cleanup(); }
  };

  useEffect(() => {
    let frame: number;
    const update = () => {
      if (outputAnalyserRef.current && isSpeaking) {
        const data = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
        outputAnalyserRef.current.getByteFrequencyData(data);
        setVolume(data.reduce((a, b) => a + b, 0) / data.length / 255);
      }
      if (inputAnalyserRef.current && isListening) {
        const data = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
        inputAnalyserRef.current.getByteFrequencyData(data);
        setInputVolume(data.reduce((a, b) => a + b, 0) / data.length / 255);
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [isSpeaking, isListening]);

  const activeHex = themeColor === 'disco' ? THEMES[discoColor].hex : THEMES[themeColor].hex;

  return (
    <div className={`h-screen w-full flex flex-col items-center justify-between p-12 overflow-hidden transition-all duration-1000 ${isGlitching ? 'animate-glitch-screen bg-white/10' : ''} ${isFlipped ? 'rotate-180' : ''} ${environment === 'void' ? 'bg-black' : ''}`}>
      
      <div className="grain-overlay" />
      {environment === 'aurora' && <div className="aurora" style={{ '--aurora-color': isSleeping ? '#1e293b' : activeHex } as any} />}
      {environment === 'space' && <div className="fixed inset-0 bg-[#010103] animate-stars z-[-1]" />}
      {environment === 'matrix' && <MatrixBackground />}
      
      <ParticleBackground color={activeHex} />
      
      <canvas ref={canvasRef} className="hidden" />

      {isCameraActive && (
        <div className={`fixed top-12 right-12 w-64 h-48 glass rounded-3xl overflow-hidden shadow-[0_30px_60px_rgba(0,0,0,0.5)] z-50 transition-all duration-700 ${isGlitching ? 'animate-glitch-screen' : ''} ${isFlipped ? 'rotate-180' : ''}`}>
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_10px_red]" />
            <span className="text-[10px] font-black text-white/60 uppercase tracking-widest">Vision Link</span>
          </div>
        </div>
      )}

      <header className="w-full max-w-6xl flex items-center justify-between z-10 transition-opacity duration-1000" style={{ opacity: isSleeping ? 0.3 : 1 }}>
        <div className="flex flex-col">
          <span className="text-[12px] font-black tracking-[0.8em] text-white/40 uppercase drop-shadow-lg">NAIM / {VERSION}</span>
          <span className="text-[8px] font-mono text-white/20 uppercase mt-1 tracking-widest">Naim Cloud Software Protocol</span>
        </div>
        <div className="flex items-center gap-4 glass px-6 py-2 rounded-full border-white/5">
          <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 shadow-[0_0_15px_#10b981]' : 'bg-white/10'}`} />
          <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em]">{isActive ? 'NEURAL SYNCED' : 'SLEEPING'}</span>
        </div>
      </header>

      <main className="flex-1 w-full relative flex flex-wrap items-center justify-center gap-16 max-w-6xl mx-auto overflow-visible">
        {[...Array(multiplicity)].map((_, i) => (
          <NAIMCharacter 
            key={i} id={i} isSpeaking={isSpeaking} isListening={isActive && !isSpeaking} isSleeping={isSleeping}
            volume={volume} inputVolume={inputVolume} themeColor={themeColor} discoColor={discoColor}
            multiplicity={multiplicity} scaleFactor={scaleFactor} isGhost={isGhost} isHologram={isHologram} 
            timeDilation={timeDilation} mood={mood}
          />
        ))}
        {error && <div className="absolute bottom-20 px-10 py-4 glass border-red-500/20 text-red-500 text-[10px] font-black rounded-full uppercase tracking-[0.5em]">{error}</div>}
      </main>

      <div className={`w-full max-w-3xl flex flex-col items-center gap-12 mb-12 z-10 transition-transform ${isFlipped ? 'rotate-180' : ''}`}>
        {!isActive ? (
          <button 
            onClick={startSession} 
            className="group relative px-24 py-10 bg-white text-black rounded-full font-black text-5xl transition-all hover:scale-110 active:scale-95 shadow-[0_0_100px_rgba(255,255,255,0.1)] tracking-tighter hover:rotate-1"
          >
            <span className="relative z-10">ACTIVATE NAIM</span>
            <div className="absolute inset-0 bg-emerald-400 opacity-0 group-hover:opacity-20 transition-opacity blur-2xl rounded-full" />
          </button>
        ) : (
          <div className="flex flex-col items-center gap-8">
            <div className="flex items-center gap-6">
              <button 
                onClick={() => toggleCamera()}
                className={`p-6 rounded-full transition-all border shadow-xl ${isCameraActive ? 'bg-cyan-500/30 border-cyan-500/50 text-cyan-400' : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10'}`}
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              
              <button onClick={() => { setIsSleeping(!isSleeping); setMultiplicity(1); setScaleFactor(1); if (!isSleeping) toggleCamera(false); }} className="px-16 py-6 glass text-white/60 hover:text-white rounded-full font-black text-[11px] tracking-[0.6em] uppercase hover:bg-white/10 transition-all border-white/10 shadow-2xl">
                {isSleeping ? 'RE-SYNC' : 'HYBERNATE'}
              </button>
              
              <button onClick={cleanup} className="p-6 bg-red-500/10 hover:bg-red-500/40 text-red-500 rounded-full border border-red-500/20 active:scale-90 transition-all shadow-xl">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <p className="text-[10px] font-black text-white/10 uppercase tracking-[1em] animate-pulse">Emotional Core Online</p>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .grain-overlay {
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background-image: url("https://grainy-gradients.vercel.app/noise.svg");
          opacity: 0.04; pointer-events: none; z-index: 100; contrast: 150%;
        }
        @keyframes stars {
          from { background: radial-gradient(1px 1px at 20px 30px, #fff, rgba(0,0,0,0)), radial-gradient(1px 1px at 150px 150px, #fff, rgba(0,0,0,0)), radial-gradient(2px 2px at 300px 50px, #fff, rgba(0,0,0,0)); background-size: 600px 600px; }
          to { background-position: 600px 1200px; }
        }
        .animate-stars { animation: stars 120s linear infinite; }
        @keyframes glitch-screen {
          0%, 100% { filter: none; transform: none; }
          20% { filter: contrast(1.5) invert(0.1) brightness(1.3); transform: translate(3px, -3px); }
          40% { clip-path: inset(15% 0 45% 0); transform: translate(-5px, 3px); }
          60% { filter: contrast(4) hue-rotate(180deg); transform: skewX(12deg); }
        }
        .animate-glitch-screen { animation: glitch-screen 0.12s linear infinite; }
        @keyframes hologram-flicker {
          0%, 100% { opacity: 0.85; transform: skewX(0.5deg); }
          5% { opacity: 0.6; transform: skewX(-1.5deg) scale(1.02); }
          50% { opacity: 0.95; transform: skewX(0); }
        }
        .animate-hologram-flicker { animation: hologram-flicker 0.08s infinite; }
        .aurora { opacity: 0.2; filter: blur(120px); mix-blend-mode: screen; }
      `}} />
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
