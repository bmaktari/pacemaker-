export const T = {
  bg: "#0E1116",
  card: "#1A1F29",
  cardAlt: "#222936",
  text: "#F2F4F8",
  dim: "#8B93A3",
  accent: "#3DDC84",
  warn: "#FFB454",
  danger: "#FF5C5C",
  pusher: "#FF6B5C",
  supporter: "#3DDC84",
  expert: "#5CA8FF",
  radius: 14,
  pad: 16,
} as const;

export const archetypeColor: Record<string, string> = {
  Pusher: T.pusher,
  Supporter: T.supporter,
  Expert: T.expert,
};
