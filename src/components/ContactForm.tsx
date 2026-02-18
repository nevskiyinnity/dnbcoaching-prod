import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Mail, User, MessageSquare } from "lucide-react";
import { z } from "zod";

const contactSchema = z.object({
  name: z.string().trim().min(1, { message: "Naam is verplicht" }).max(100),
  email: z.string().trim().email({ message: "Ongeldig e-mailadres" }).max(255),
  message: z.string().trim().min(1, { message: "Bericht is verplicht" }).max(1000),
});

export const ContactForm = () => {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            contactSchema.parse(formData);

            // Send the form data to our serverless function
            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
            });

            // If the server responds with an error, throw an error
            if (!response.ok) {
                throw new Error('Failed to send message.');
            }

            // Show success message
            toast({
                title: "Bericht verzonden!",
                description: "We nemen zo snel mogelijk contact met je op.",
            });

            // Reset the form
            setFormData({ name: "", email: "", message: "" });

        } catch (error) {
            if (error instanceof z.ZodError) {
                // Handle Zod validation errors
                toast({
                    title: "Validatiefout",
                    description: error.errors[0].message,
                    variant: "destructive",
                });
            } else {
                // Handle network or other errors
                toast({
                    title: "Er is iets misgegaan",
                    description: "Probeer het later opnieuw.",
                    variant: "destructive",
                });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

  return (
    <section id="contact" className="py-24 relative">
      {/* Glow effect */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-primary/20 rounded-full blur-[120px] -z-10"></div>

      <div className="container mx-auto px-4">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-12 space-y-4">
            <h2 className="text-4xl md:text-5xl font-bold">
              Zet vandaag de eerste stap
            </h2>
            <p className="text-xl text-muted-foreground">
              Wil jij je passie omzetten in een carrière als online coach? 
              Sluit je aan bij DNB Coaching en start zonder investering of risico.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Jouw naam"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="pl-12 h-12 bg-card/50 backdrop-blur-sm border-border/50 focus:border-primary"
                maxLength={100}
              />
            </div>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="email"
                placeholder="Jouw e-mailadres"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="pl-12 h-12 bg-card/50 backdrop-blur-sm border-border/50 focus:border-primary"
                maxLength={255}
              />
            </div>

            <div className="relative">
              <MessageSquare className="absolute left-3 top-4 w-5 h-5 text-muted-foreground" />
              <Textarea
                placeholder="Vertel ons over jezelf en waarom je coach wilt worden..."
                value={formData.message}
                onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                className="pl-12 min-h-32 bg-card/50 backdrop-blur-sm border-border/50 focus:border-primary resize-none"
                maxLength={1000}
              />
            </div>

            <Button 
              type="submit" 
              variant="hero" 
              size="lg" 
              className="w-full"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Verzenden..." : "Aanmelden"}
            </Button>
          </form>
        </div>
      </div>
    </section>
  );
};
