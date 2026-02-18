import { useState, useEffect, useRef } from 'react';

// Web Speech API types (vendor-prefixed)
interface SpeechRecognitionEvent {
    results: { 0: { 0: { transcript: string } } };
}

interface SpeechRecognitionErrorEvent {
    error: string;
}

interface SpeechRecognitionInstance {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
}

declare global {
    interface Window {
        SpeechRecognition?: new () => SpeechRecognitionInstance;
        webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    }
}

export function useVoiceInput() {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState('');
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

    useEffect(() => {
        if (typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) return;
            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.continuous = false;
            recognitionRef.current.interimResults = false;
            recognitionRef.current.lang = 'nl-NL'; // Default to Dutch

            recognitionRef.current.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                setTranscript(transcript);
                setIsListening(false);
            };

            recognitionRef.current.onerror = (event) => {
                console.error("Speech recognition error", event.error);
                setIsListening(false);
            };

            recognitionRef.current.onend = () => {
                setIsListening(false);
            };
        }
    }, []);

    const startListening = () => {
        if (recognitionRef.current) {
            setTranscript(''); // Clear previous
            recognitionRef.current.start();
            setIsListening(true);
        } else {
            alert("Voice input is not supported in this browser.");
        }
    };

    const stopListening = () => {
        if (recognitionRef.current) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
    };

    return { isListening, transcript, startListening, stopListening, recognition: recognitionRef.current };
}
