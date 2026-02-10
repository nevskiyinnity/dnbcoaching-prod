import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';

export function useSync(userCode: string | null) {
    const [synced, setSynced] = useState(false);
    const [userData, setUserData] = useState<any>({});

    // Use a ref to keep track of the latest userData without triggering re-renders or stale closures in callbacks
    const userDataRef = useRef<any>({});

    // Update ref when state changes (from down-sync)
    useEffect(() => {
        userDataRef.current = userData;
    }, [userData]);

    // 1. Down-Sync: Load from server
    useEffect(() => {
        if (!userCode) return;

        const syncDown = async () => {
            try {
                const res = await fetch(`/api/sync?code=${userCode}`);
                if (!res.ok) throw new Error('Failed to fetch sync data');
                const serverData = await res.json();

                setUserData(serverData);
                userDataRef.current = serverData; // Update ref immediately

                // Persist server data to local storage for offline access/hooks
                if (serverData.gamification) {
                    localStorage.setItem('bot_gamification', JSON.stringify(serverData.gamification));
                }
                if (serverData.chatHistory) {
                    localStorage.setItem('bot_history_v2', JSON.stringify(serverData.chatHistory));
                }

                // Trigger storage event for other components
                window.dispatchEvent(new Event("storage"));
                setSynced(true);
            } catch (e) {
                console.error('Sync error:', e);
            }
        };

        syncDown();
    }, [userCode]);

    // 2. Up-Sync: Update one key, merge with CURRENT ref data, save to server
    const syncUp = useCallback(async (key: string, value: any) => {
        if (!userCode) return;

        try {
            // Get latest data from ref to avoid stale closures
            const currentData = userDataRef.current;
            const newData = { ...currentData, [key]: value };

            // Optimistic update locally
            setUserData(newData);
            userDataRef.current = newData; // Update ref

            // Send to server
            await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: userCode, data: newData })
            });

        } catch (e) {
            console.error('Sync up error:', e);
        }
    }, [userCode]); // Removed userData dependency to avoid recreation on every state change

    return { synced, userData, syncUp };
}
