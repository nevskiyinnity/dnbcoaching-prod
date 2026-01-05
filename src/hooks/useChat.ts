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

    const saveToHistory = useCallback((newMessages: ChatMessage[]) => {
        // 1. Local Save
        localStorage.setItem("bot_history_v2", JSON.stringify(newMessages));
        setMessages(newMessages);

        // 2. Cloud Save
        syncUp('chatHistory', newMessages);
    }, [syncUp]);

    // Auto-Gamification Logic
    const updateGamification = useCallback(() => {
        const stored = localStorage.getItem('bot_gamification');
        let stats = stored ? JSON.parse(stored) : { streak: 0, score: 0, badges: 0, lastActive: null };

        const now = new Date();
        const last = stats.lastActive ? new Date(stats.lastActive) : null;

        let newStreak = stats.streak;
        let newScore = stats.score;

        if (!last) {
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

    }, [syncUp]);

    const send = async (text: string, image?: string) => {
        if (!text.trim() && !image) return;

        // Create User Message
        const userMsg: ChatMessage = {
            role: "user",
            content: text + (image ? " [Image Uploaded]" : ""),
            id: Date.now().toString(),
            blocks: parseBlocks(text + (image ? " [Image Uploaded]" : "")) // Use parseBlocks for user message too
        };

        const newHistory = [...messages, userMsg];
        saveToHistory(newHistory);
        updateGamification(); // AUTO-GAMIFICATION TRIGGER
        setLoading(true);

        try {
            // Prepare payload
            // If we have an image, we send it separately or as part of the content logic we built in backend
            const payload = {
                messages: newHistory.map(({ role, content }) => ({ role, content })), // Send only role and content to API
                code: userCode,
                name: userName,
                lang,
                image: image // Send image to backend if present
            };

            const res = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error(await res.text());

            const data = await res.json();
            const assistantText = data.message;

            // Parse Blocks (Video detection)
            const blocks: MessageBlock[] = parseBlocks(assistantText);

            const assistantMsg: ChatMessage = {
                role: "assistant",
                content: assistantText,
                blocks,
                id: (Date.now() + 1).toString()
            };

            saveToHistory([...newHistory, assistantMsg]);
        } catch (err: any) {
            toast.error("Error sending message: " + err.message);
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
        isPinned: (id: string) => pinnedMessages.includes(id)
    };
}
