export interface Theme {
  color: Record<string, string>;
  space: Record<string, number>;
  radius: Record<string, number>;
}

export const theme: Theme = {
  color: {
    primary: "#4f46e5",
    "primary.hover": "#4338ca",
    "on-primary": "#ffffff",
  },
  space: { "2": 8, "4": 16 },
  radius: { md: 8 },
};
