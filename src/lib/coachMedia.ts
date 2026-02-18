export const coachMedia = {
  motivation: {
    type: 'youtube' as const,
    title: '30 sec motivatie boost',
    youtubeId: '',
  },
  plateau: {
    type: 'youtube' as const,
    title: 'Plateau doorbreken in 60 sec',
    youtubeId: '',
  },
  congratulations: {
    type: 'youtube' as const,
    title: 'Gefeliciteerd – next level!',
    youtubeId: '',
  },
};
export type CoachMediaKey = keyof typeof coachMedia;