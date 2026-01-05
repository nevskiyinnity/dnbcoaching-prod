import { useState, useEffect } from 'react';
import { toast } from "sonner";

export function useBotAuth() {
    const [userCode, setUserCode] = useState<string>(localStorage.getItem("bot_user_code") || "");
    const [dbName, setDbName] = useState<string>(localStorage.getItem("bot_user_name") || "");
    const [authenticated, setAuthenticated] = useState<boolean>(!!localStorage.getItem("bot_user_code"));
    const [inputName, setInputName] = useState<string>(localStorage.getItem("bot_name") || "");
    const [lang, setLang] = useState<'nl' | 'en'>((localStorage.getItem("bot_lang") as 'nl' | 'en') || 'nl');

    useEffect(() => { if (inputName) localStorage.setItem("bot_name", inputName); }, [inputName]);
    useEffect(() => { if (lang) localStorage.setItem("bot_lang", lang); }, [lang]);

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

            localStorage.setItem("bot_user_code", code.trim());
            localStorage.setItem("bot_user_name", returnedName);

            setUserCode(code.trim());
            setDbName(returnedName);
            setAuthenticated(true);
            toast.success(`Welcome, ${returnedName}!`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Invalid code';
            toast.error(msg);
        }
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
        login
    };
}
