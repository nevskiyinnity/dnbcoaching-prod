import React from 'react';
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Pin } from "lucide-react";

interface ChatBubbleProps {
    role: "user" | "assistant";
    children: React.ReactNode;
    onPin?: () => void;
    isPinned?: boolean;
}

export function ChatBubble({ role, children, onPin, isPinned }: ChatBubbleProps) {
    const isUser = role === "user";
    return (
        <div className={cn("flex group", isUser ? "justify-end" : "justify-start")}>
            <div className={cn(
                "max-w-[85%] rounded-lg px-4 py-3 text-sm shadow-sm relative",
                isUser ? "bg-primary text-primary-foreground" : "bg-muted/30 border border-border"
            )}>
                {children}
                {!isUser && onPin && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "absolute -top-2 -right-2 h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity",
                            isPinned && "opacity-100"
                        )}
                        onClick={onPin}
                        title={isPinned ? "Unpin" : "Pin this message"}
                    >
                        <Pin size={14} className={cn(isPinned && "fill-current")} />
                    </Button>
                )}
            </div>
        </div>
    );
}
