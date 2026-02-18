import { useState, useEffect } from 'react';
import { toast } from "sonner";

export function useBotAuth() {
    const [userCode, setUserCode] = useState<string>(sessionStorage.getItem("bot_user_code") || "");
    const [dbName, setDbName] = useState<string>(sessionStorage.getItem("bot_user_name") || "");
    const [authenticated, setAuthenticated] = useState<boolean>(!!sessionStorage.getItem("bot_user_code"));
    const [inputName, setInputName] = useState<string>(sessionStorage.getItem("bot_name") || "");
    const [lang, setLang] = useState<'nl' | 'en'>((sessionStorage.getItem("bot_lang") as 'nl' | 'en') || 'nl');

    useEffect(() => { if (inputName) sessionStorage.setItem("bot_name", inputName); }, [inputName]);
    useEffect(() => { if (lang) sessionStorage.setItem("bot_lang", lang); }, [lang]);

    // Priority name: Manual Input > DB Name
    const effectiveName = inputName.trim() || dbName;

    async function login(code: string) {
        if (!code.trim()) {
            toast.error("Please enter a code");
            return;
        }

        try {
            const resp = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: code.trim(), validateOnly: true }),
            });
            const data = await resp.json().catch(() => ({}));

            if (!resp.ok || !data.valid) {
                throw new Error(data.message || "Invalid or expired code");
            }

            const returnedName = data.userName || "";

            sessionStorage.setItem("bot_user_code", code.trim());
            sessionStorage.setItem("bot_user_name", returnedName);
            sessionStorage.setItem("bot_login_ts", Date.now().toString());

            setUserCode(code.trim());
            setDbName(returnedName);
            setAuthenticated(true);
            toast.success(`Welcome, ${returnedName}!`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Invalid code';
            toast.error(msg);
        }
    }

    function logout() {
        sessionStorage.removeItem("bot_user_code");
        sessionStorage.removeItem("bot_user_name");
        sessionStorage.removeItem("bot_name");
        sessionStorage.removeItem("bot_lang");
        sessionStorage.removeItem("bot_gamification");
        sessionStorage.removeItem("bot_history_v2");
        sessionStorage.removeItem("bot_pins");
        sessionStorage.removeItem("bot_login_ts");

        setUserCode("");
        setDbName("");
        setInputName("");
        setAuthenticated(false);
        toast.info("Logged out");
    }

    return {
        userCode,
        dbName,
        inputName,
        setInputName,
        effectiveName,
        authenticated,
        lang,
        setLang,
        login,
        logout
    };
}
