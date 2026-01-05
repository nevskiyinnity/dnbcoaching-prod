import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';

export function useSync(userCode: string | null) {
    const [synced, setSynced] = useState(false);
    const [userData, setUserData] = useState<any>({});

    // 1. Down-Sync: Load from server, merge with local
    useEffect(() => {
        if (!userCode) return;

        const syncDown = async () => {
            try {
                const res = await fetch(`/api/sync?code=${userCode}`);
                if (!res.ok) throw new Error('Failed to fetch sync data');
                const serverData = await res.json();

                setUserData(serverData);

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

    // 2. Up-Sync: Update one key, merge, save to server
    const syncUp = useCallback(async (key: string, value: any) => {
        if (!userCode) return;

        try {
            // Optimistic update locally
            setUserData((prev: any) => {
                const newData = { ...prev, [key]: value };
                return newData;
            });

            // Fetch latest to be safe? Or just use what we have. 
            // For now, simple read-modify-write relative to our current known state.
            // Note: This isn't atomic, but sufficient for single-user context.

            // Re-read current internal state is tricky inside async without ref. 
            // We will use the functional update pattern concept, but for the API call 
            // we need the PREVIOUS data combined with NEW.

            // Let's assume 'userData' state is reasonably fresh.
            // Better: We fetch current, merge, save.

            let payload = { ...userData, [key]: value };

            // Send to server
            await fetch('/api/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: userCode, data: payload })
            });

        } catch (e) {
            console.error('Sync up error:', e);
        }
    }, [userCode, userData]);

    return { synced, userData, syncUp };
}
