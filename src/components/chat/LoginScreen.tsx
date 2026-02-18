import { SignIn } from '@clerk/clerk-react';

export function LoginScreen() {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <SignIn
                routing="hash"
                appearance={{
                    elements: {
                        rootBox: "mx-auto",
                        card: "shadow-md",
                    },
                }}
            />
        </div>
    );
}
