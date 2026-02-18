import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/clerk-react';

export interface SyncData {
    gamification?: { streak: number; score: number; badges: number; lastActive: string | null };
    chatHistory?: unknown[];
    [key: string]: unknown;
}

export function useSync(userCode: string | null) {
    const [synced, setSynced] = useState(false);
    const [userData, setUserData] = useState<SyncData>({});
    const { getToken } = useAuth();

    const userDataRef = useRef<SyncData>({});

    useEffect(() => {
        userDataRef.current = userData;
    }, [userData]);

    // 1. Down-Sync: Load from server using Clerk token
    useEffect(() => {
        if (!userCode) return;

        const syncDown = async () => {
            try {
                const token = await getToken();
                const res = await fetch('/api/sync', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });
                if (!res.ok) throw new Error('Failed to fetch sync data');
                const serverData = await res.json();

                setUserData(serverData);
                userDataRef.current = serverData;

                if (serverData.gamification) {
                    localStorage.setItem('bot_gamification', JSON.stringify(serverData.gamification));
                }
                if (serverData.chatHistory) {
                    localStorage.setItem('bot_history_v2', JSON.stringify(serverData.chatHistory));
                }

                window.dispatchEvent(new Event("storage"));
                setSynced(true);
            } catch (e) {
                console.error('Sync error:', e);
            }
        };

        syncDown();
    }, [userCode, getToken]);

    // 2. Up-Sync: Update one key, merge with CURRENT ref data, save to server
    const syncUp = useCallback(async (key: string, value: unknown) => {
        if (!userCode) return;

        try {
            const currentData = userDataRef.current;
            const newData = { ...currentData, [key]: value };

            setUserData(newData);
            userDataRef.current = newData;

            const token = await getToken();
            await fetch('/api/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ data: newData })
            });

        } catch (e) {
            console.error('Sync up error:', e);
        }
    }, [userCode, getToken]);

    return { synced, userData, syncUp };
}
