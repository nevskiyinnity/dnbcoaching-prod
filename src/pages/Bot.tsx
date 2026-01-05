import React, { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sparkles, Pin, X } from "lucide-react";
import { LoginScreen } from "@/components/chat/LoginScreen";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatBubble } from "@/components/chat/ChatBubble";
import { VideoBlock } from "@/components/chat/VideoBlock";
import { useBotAuth } from "@/hooks/useBotAuth";
import { useChat } from "@/hooks/useChat";

import { useSync } from "@/hooks/useSync";

// Default stats
const DEFAULT_STATS = { streak: 0, badges: 0, score: 0 };

export default function Bot() {
  const {
    authenticated,
    userCode,
    effectiveName,
    inputName,
    setInputName,
    lang,
    setLang,
    login
  } = useBotAuth();

  // Sync Hook
  const { synced, syncUp } = useSync(userCode);

  // Local Gamification State
  const [stats, setStats] = React.useState(() => {
    try {
      const saved = localStorage.getItem('bot_gamification');
      return saved ? JSON.parse(saved) : DEFAULT_STATS;
    } catch (e) {
      console.error("Error parsing gamification stats:", e);
      return DEFAULT_STATS;
    }
  });

  // Listen for sync updates (from useSync hook)
  useEffect(() => {
    const handleStorage = () => {
      try {
        const saved = localStorage.getItem('bot_gamification');
        if (saved) setStats(JSON.parse(saved));
      } catch (e) {
        console.error("Error parsing sync update:", e);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const {
    loading,
    send,
    pinnedMessages,
    assistantBlocks,
    pinnedBlocks,
    togglePin,
    isPinned
  } = useChat(userCode, effectiveName, lang);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [assistantBlocks, loading]);

  if (!authenticated) {
    return <LoginScreen onLogin={login} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold">DNB Coach Bot</h1>
            <p className="text-muted-foreground">Persoonlijk plan • Voeding • Mindset • Progressie • Community</p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Jouw naam (optioneel)"
              value={inputName}
              onChange={e => setInputName(e.target.value)}
              className="w-48"
            />
            {/* Name auto-saves via hook effect */}
            <div className="flex items-center gap-1">
              <LangButton active={lang === 'nl'} onClick={() => setLang('nl')}>NL</LangButton>
              <LangButton active={lang === 'en'} onClick={() => setLang('en')}>EN</LangButton>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 space-y-4">
            {pinnedMessages.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Pin size={14} /> Pinned Messages
                </h3>
                <div className="space-y-2">
                  {pinnedBlocks.map((m) => (
                    <div key={m.id} className="rounded-xl border border-primary/30 bg-card p-4 relative">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="absolute top-2 right-2 h-6 w-6 p-0"
                        onClick={() => togglePin(m)}
                      >
                        <X size={14} />
                      </Button>
                      <div className="pr-8">
                        {m.blocks.map((b, i) =>
                          b.type === "video" ? (
                            <VideoBlock key={i} id={b.id} />
                          ) : (
                            <p key={i} className="whitespace-pre-wrap leading-relaxed text-sm">{b.text}</p>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border bg-card/50 backdrop-blur-sm p-4 h-[70vh] flex flex-col">
              <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                {assistantBlocks.map((m) => (
                  <ChatBubble key={m.id} role={m.role} onPin={() => togglePin(m)} isPinned={isPinned(m.id)}>
                    {m.blocks.map((b, i) =>
                      b.type === "video" ? (
                        <VideoBlock key={i} id={b.id} />
                      ) : (
                        <p key={i} className="whitespace-pre-wrap leading-relaxed">{b.text}</p>
                      )
                    )}
                  </ChatBubble>
                ))}
                {loading && <ChatBubble role="assistant"><p>Even denken…</p></ChatBubble>}
                <div ref={bottomRef} />
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <div className="flex gap-2 flex-wrap">
                  <QuickAction onClick={() => send("Maak een persoonlijk trainingsplan voor mij.")}>Trainingsplan</QuickAction>
                  <QuickAction onClick={() => send("Bereken mijn macro's voor cut/bulk met voorbeeld dagmenu.")}>Macro's + menu</QuickAction>
                  <QuickAction onClick={() => send("Dagelijkse check-in: hoe ging het vandaag?")}>Check-in</QuickAction>
                  <QuickAction onClick={() => send("Ik mis motivatie")}>Motivatie</QuickAction>
                </div>

                <ChatInput onSend={send} loading={loading} />
              </div>
            </div>
          </div>

          <aside className="lg:col-span-1 space-y-4">
            <div className="rounded-xl border bg-card/50 p-4">
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-semibold">Gamification</h3>
                {synced && <span className="text-[10px] text-green-500 uppercase font-mono tracking-wider">Synced</span>}
              </div>
              <ul className="text-sm text-muted-foreground space-y-1 mb-4">
                <li>Consistentie: {stats.streak} dagen streak</li>
                <li>PR badges: {stats.badges}</li>
                <li>Weekscore: {stats.score} XP</li>
              </ul>
              <div className="grid grid-cols-1 gap-2 mb-2">
                <Button onClick={() => window.location.href = '/progress'} variant="outline" className="w-full text-xs" size="sm">
                  <Sparkles size={14} className="mr-2" /> Progressie
                </Button>
              </div>
            </div>
            <div className="rounded-xl border bg-card/50 p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2"><Sparkles size={16} /> Tips</h3>
              <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                <li>Begin met je doel en beschikbaarheid.</li>
                <li>De bot past je plan automatisch aan.</li>
                <li>Typ "intake" om opnieuw te starten.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function QuickAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button onClick={onClick} variant="outline" size="sm" className="rounded-full">
      {children}
    </Button>
  );
}

function LangButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button onClick={onClick} variant={active ? 'hero' : 'outline'} size="sm" className="rounded-full px-3">
      {children}
    </Button>
  );
}