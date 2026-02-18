import React from 'react';
import { Video } from 'lucide-react';
import { coachMedia } from '@/lib/coachMedia';

export function VideoBlock({ id }: { id: keyof typeof coachMedia }) {
    const media = coachMedia[id];
    if (!media || !media.youtubeId) return null;
    return (
        <div className="my-2">
            <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Video size={14} /> Coach video: {media.title}</div>
            {media.type === 'youtube' && (
                <div className="aspect-video w-full rounded-lg overflow-hidden border">
                    <iframe
                        className="w-full h-full"
                        src={`https://www.youtube.com/embed/${media.youtubeId}`}
                        title={media.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                    />
                </div>
            )}
        </div>
    );
}
