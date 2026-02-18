import { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from "sonner";
import { coachMedia } from '@/lib/coachMedia';
import { useSync } from './useSync';

export interface MessageBlock {
    type: "text" | "video";
    text?: string;
    id: string;
}

export interface ChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
    blocks: MessageBlock[];
    id: string;
}

function uid() { return Math.random().toString(36).slice(2) }

const seedAssistant = `Kies je taal / Choose your language: Nederlands of English?

Yo! Ik ben je DNB Coach Bot. Zullen we starten met een korte intake?
- Wat is je doel (cut / bulk / recomp)?
- Huidig niveau & blessures?
- Hoeveel dagen per week wil je trainen en hoeveel tijd per sessie?
- Materiaal (gym / home / beperkt)?`;

function parseBlocks(text: string): MessageBlock[] {
    const parts: MessageBlock[] = [];
    const re = /\[video:([a-zA-Z0-9_-]+)\]/g;
    let lastIndex = 0; let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        if (m.index > lastIndex) parts.push({ type: 'text', text: text.slice(lastIndex, m.index), id: `text-${Date.now()}-${lastIndex}` });
        const videoId = m[1] as keyof typeof coachMedia;
        // Assuming coachMedia is still relevant for validating video IDs
        if (coachMedia[videoId]) parts.push({ type: 'video', id: videoId });
        lastIndex = re.lastIndex;
    }
    if (lastIndex < text.length) parts.push({ type: 'text', text: text.slice(lastIndex), id: `text-${Date.now()}-${lastIndex}` });
    return parts;
}



function isSameDay(d1: Date, d2: Date) {
    return d1 && d2 && d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate();
}

export function useChat(userCode: string | null, userName: string, lang: 'nl' | 'en') {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [loading, setLoading] = useState(false);
    const [pinnedMessages, setPinnedMessages] = useState<string[]>([]);

    // Use Sync Hook for Cloud Storage
    const { syncUp, userData, synced } = useSync(userCode);

    // Load from local storage (which useSync populates from server) OR directly from sync
    // We prioritize local storage for immediate render, but update if Sync changes things
    useEffect(() => {
        const saved = localStorage.getItem("bot_history_v2");
        if (saved) {
            try {
                setMessages(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to parse history", e);
            }
        }
    }, [synced]); // Re-run when sync completes

    useEffect(() => {
        const savedPins = localStorage.getItem("bot_pins");
        if (savedPins) setPinnedMessages(JSON.parse(savedPins));
    }, []);

    // Auto-Gamification Logic
    const updateGamification = useCallback(() => {
        try {
            const stored = localStorage.getItem('bot_gamification');
            let stats = stored ? JSON.parse(stored) : { streak: 0, score: 0, badges: 0, lastActive: null };

            const now = new Date();
            const last = stats.lastActive ? new Date(stats.lastActive) : null;

            let newStreak = stats.streak;
            let newScore = stats.score;

            // Valid Date check
            if (!last || isNaN(last.getTime())) {
                // reset if invalid
                newStreak = 1;
                newScore += 10;
            } else if (isSameDay(now, last)) {
                // Already active today, just add small score
                newScore += 1; // Small XP for continued chatting
            } else {
                // Different day
                const yesterday = new Date();
                yesterday.setDate(now.getDate() - 1);

                if (isSameDay(yesterday, last)) {
                    // Consecutive day
                    newStreak += 1;
                    newScore += 20 + (newStreak * 5); // Bonus for streak
                } else {
                    // Streaks broken
                    newStreak = 1;
                    newScore += 10;
                }
            }

            const newStats = { ...stats, streak: newStreak, score: newScore, lastActive: now.toISOString() };

            // Save
            localStorage.setItem('bot_gamification', JSON.stringify(newStats));
            syncUp('gamification', newStats);

            // Trigger update for UI
            window.dispatchEvent(new Event("storage"));
        } catch (e) {
            console.error("Error in gamification logic", e);
        }

    }, [syncUp]);

    const send = async (text: string, image?: string) => {
        if (!text.trim() && !image) return;

        setLoading(true); // Set loading immediately

        try {
            // Create User Message
            const userMsg: ChatMessage = {
                role: "user",
                content: text + (image ? " [Image Uploaded]" : ""),
                id: Date.now().toString(),
                blocks: parseBlocks(text + (image ? " [Image Uploaded]" : ""))
            };

            const newHistory = [...messages, userMsg];

            // Optimistic update
            setMessages(newHistory);
            localStorage.setItem("bot_history_v2", JSON.stringify(newHistory));
            syncUp('chatHistory', newHistory);

            // Trigger gamification safely
            try {
                updateGamification();
            } catch (e) {
                console.error("Gamification update failed", e);
            }

            // Prepare payload
            const payload = {
                messages: newHistory.map(({ role, content }) => ({ role, content })),
                code: userCode,
                name: userName,
                lang,
                image: image
            };

            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error(await res.text());

            const data = await res.json();
            const assistantText = data.message;

            const blocks: MessageBlock[] = parseBlocks(assistantText);

            const assistantMsg: ChatMessage = {
                role: "assistant",
                content: assistantText,
                blocks,
                id: (Date.now() + 1).toString()
            };

            const finalHistory = [...newHistory, assistantMsg];
            setMessages(finalHistory);
            localStorage.setItem("bot_history_v2", JSON.stringify(finalHistory));
            syncUp('chatHistory', finalHistory);

        } catch (err) {
            console.error("Chat error:", err);
            toast.error("Error sending message: " + (err instanceof Error ? err.message : String(err)));
        } finally {
            setLoading(false);
        }
    };

    const togglePin = (msg: ChatMessage) => {
        const newPins = pinnedMessages.includes(msg.id)
            ? pinnedMessages.filter(id => id !== msg.id)
            : [...pinnedMessages, msg.id];

        setPinnedMessages(newPins);
        localStorage.setItem("bot_pins", JSON.stringify(newPins));
        // syncUp('pinnedMessages', newPins); // Optional: Sync pins too
    };

    // Filter messages to only include those that are not 'system' role for display
    const assistantBlocks = messages.filter(m => m.role !== 'system');
    // Filter messages to get the actual pinned message objects
    const pinnedBlocks = messages.filter(m => pinnedMessages.includes(m.id));

    return {
        messages,
        loading,
        send,
        pinnedMessages,
        assistantBlocks, // Actually all displayable blocks
        pinnedBlocks,
        togglePin,
        isPinned: (id: string) => pinnedMessages.includes(id),
        synced, // Expose synced state
        userData // Expose raw user data for system checks
    };
}
