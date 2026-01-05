import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LogIn } from "lucide-react";

interface LoginScreenProps {
    onLogin: (code: string) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        setLoading(true);
        await onLogin(code);
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <Card className="w-full max-w-md">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <LogIn size={24} /> Bot Login
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        Enter your access code to use the DNB Coach Bot.
                    </p>
                    <div>
                        <Label htmlFor="code">Access Code</Label>
                        <Input
                            id="code"
                            value={code}
                            onChange={(e) => setCode(e.target.value.toUpperCase())}
                            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                            placeholder="Enter your code"
                            className="uppercase font-mono"
                        />
                    </div>
                    <Button onClick={handleSubmit} disabled={loading} className="w-full">
                        Login
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
