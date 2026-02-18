import { useUser, useAuth, useClerk } from '@clerk/clerk-react';
import { useState, useEffect } from 'react';

export function useBotAuth() {
    const { isSignedIn, user, isLoaded } = useUser();
    const { getToken } = useAuth();
    const clerk = useClerk();
    const [lang, setLang] = useState<'nl' | 'en'>((sessionStorage.getItem("bot_lang") as 'nl' | 'en') || 'nl');
    const [inputName, setInputName] = useState<string>(sessionStorage.getItem("bot_name") || "");

    useEffect(() => { if (inputName) sessionStorage.setItem("bot_name", inputName); }, [inputName]);
    useEffect(() => { if (lang) sessionStorage.setItem("bot_lang", lang); }, [lang]);

    // Clerk user's display name (from Clerk profile)
    const dbName = user?.firstName || user?.fullName || "";

    // Priority name: Manual Input > Clerk Name
    const effectiveName = inputName.trim() || dbName;

    // The Clerk userId acts as the identifier (replaces old access code)
    const userCode = user?.id || "";

    function logout() {
        sessionStorage.removeItem("bot_name");
        sessionStorage.removeItem("bot_lang");
        sessionStorage.removeItem("bot_gamification");
        sessionStorage.removeItem("bot_history_v2");
        sessionStorage.removeItem("bot_pins");
        clerk.signOut();
    }

    return {
        userCode,
        dbName,
        inputName,
        setInputName,
        effectiveName,
        authenticated: !!isSignedIn,
        isLoaded,
        lang,
        setLang,
        login: async () => {}, // No-op: Clerk handles sign-in via <SignIn /> component
        logout,
        getToken,
    };
}
