import React, { useState, useEffect, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Send, Mic, MicOff, Paperclip, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { cn } from "@/lib/utils";
import { toast } from 'sonner';

interface ChatInputProps {
    onSend: (text: string, image?: string) => void;
    loading: boolean;
}

export function ChatInput({ onSend, loading }: ChatInputProps) {
    const [input, setInput] = useState("");
    const [image, setImage] = useState<string | null>(null);
    const isMobile = useIsMobile();
    const { isListening, transcript, startListening, stopListening } = useVoiceInput();
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (transcript) {
            setInput(prev => prev + (prev ? ' ' : '') + transcript);
        }
    }, [transcript]);

    const handleSend = () => {
        if (!input.trim() && !image) return;
        onSend(input, image || undefined);
        setInput("");
        setImage(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 5 * 1024 * 1024) { // 5MB limit
                toast.error("Image too large (max 5MB)");
                return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                setImage(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="flex flex-col gap-2">
            {image && (
                <div className="relative w-20 h-20">
                    <img src={image} alt="Preview" className="w-full h-full object-cover rounded-lg border" />
                    <button
                        onClick={() => setImage(null)}
                        className="absolute -top-2 -right-2 bg-destructive text-white rounded-full p-0.5 shadow-sm hover:bg-destructive/90"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}
            <div className="flex items-end gap-2">
                <div className="relative flex-1">
                    <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                    />

                    {isMobile ? (
                        <Textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder={isListening ? "Listening..." : "Typ je bericht…"}
                            className={cn("min-h-[44px] pl-10", isListening && "border-green-500 ring-1 ring-green-500")}
                            onKeyDown={handleKeyDown}
                        />
                    ) : (
                        <Input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder={isListening ? "Listening..." : "Typ je bericht…"}
                            className={cn("pl-10", isListening && "border-green-500 ring-1 ring-green-500")}
                            onKeyDown={handleKeyDown}
                        />
                    )}

                    <Button
                        variant="ghost"
                        size="sm"
                        className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <Paperclip size={16} />
                    </Button>

                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "absolute right-2 top-1/2 -translate-y-1/2 rounded-full h-8 w-8 p-0",
                            isListening ? "text-red-500 animate-pulse bg-red-100" : "text-muted-foreground"
                        )}
                        onClick={isListening ? stopListening : startListening}
                    >
                        {isListening ? <MicOff size={16} /> : <Mic size={16} />}
                    </Button>
                </div>
                <Button onClick={handleSend} disabled={loading} className="shrink-0" variant="hero">
                    <Send className="mr-2" size={16} /> Stuur
                </Button>
            </div>
        </div>
    );
}
