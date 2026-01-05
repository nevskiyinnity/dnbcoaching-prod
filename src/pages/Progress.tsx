import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ArrowLeft, TrendingUp, Calendar } from "lucide-react";
import { useNavigate } from 'react-router-dom';
import { useBotAuth } from "@/hooks/useBotAuth";
import { toast } from "sonner";

interface WeightEntry {
    date: string;
    weight: number;
}

export default function Progress() {
    const navigate = useNavigate();
    const { userCode, effectiveName } = useBotAuth();
    const [weight, setWeight] = useState("");
    const [data, setData] = useState<WeightEntry[]>([]);

    useEffect(() => {
        if (userCode) {
            const saved = localStorage.getItem(`progress_weight_${userCode}`);
            if (saved) {
                setData(JSON.parse(saved));
            }
        }
    }, [userCode]);

    const handleAddWeight = () => {
        const val = parseFloat(weight);
        if (!val || isNaN(val)) {
            toast.error("Voer een geldig getal in");
            return;
        }

        const today = new Date().toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit' });
        const newData = [...data, { date: today, weight: val }];
        setData(newData);
        localStorage.setItem(`progress_weight_${userCode}`, JSON.stringify(newData));
        setWeight("");
        toast.success("Gewicht opgeslagen!");
    };

    if (!userCode) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-bold">Niet ingelogd</h2>
                    <Button onClick={() => navigate('/bot')} className="mt-4">Ga naar Bot</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background p-4 md:p-8">
            <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" onClick={() => navigate('/bot')}>
                        <ArrowLeft className="mr-2" size={16} /> Terug naar Bot
                    </Button>
                    <h1 className="text-3xl font-bold">Jouw Progressie</h1>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="text-primary" /> Gewicht Loggen
                            </CardTitle>
                            <CardDescription>Houd je gewicht bij om trends te zien.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="flex gap-2">
                                <Input
                                    type="number"
                                    placeholder="Gewicht (kg)"
                                    value={weight}
                                    onChange={(e) => setWeight(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddWeight()}
                                />
                                <Button onClick={handleAddWeight}>Toevoegen</Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Calendar className="text-primary" /> Statistieken
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Start:</span>
                                <span className="font-bold">{data.length > 0 ? `${data[0].weight} kg` : '-'}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Huidig:</span>
                                <span className="font-bold">{data.length > 0 ? `${data[data.length - 1].weight} kg` : '-'}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Entries:</span>
                                <span className="font-bold">{data.length}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                <Card className="h-[400px]">
                    <CardHeader>
                        <CardTitle>Gewichtsverloop</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[320px]">
                        {data.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                    <XAxis dataKey="date" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                                        itemStyle={{ color: 'hsl(var(--foreground))' }}
                                    />
                                    <Line type="monotone" dataKey="weight" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-muted-foreground">
                                Nog geen data. Log je eerste weging!
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
