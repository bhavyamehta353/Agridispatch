/** Maturity grades — same visuals as the farmer intake form. */
export const MATURITY_SWATCHES: Record<
  string,
  { swatch: string; short: string }
> = {
  Breaker: {
    swatch:
      "linear-gradient(135deg, #2e7d32 0%, #2e7d32 50%, #c9a227 65%, #e8d4b8 78%, #2e7d32 100%)",
    short: "Br",
  },
  Turning: {
    swatch:
      "linear-gradient(135deg, #388e3c 0%, #cddc39 32%, #ffcc80 48%, #f48fb1 62%, #43a047 100%)",
    short: "Tu",
  },
  Pink: {
    swatch:
      "linear-gradient(135deg, #81c784 0%, #f8bbd9 38%, #ec407a 72%, #ad1457 100%)",
    short: "Pk",
  },
  "Light Red": {
    swatch:
      "linear-gradient(135deg, #ffcdd2 0%, #e57373 42%, #e53935 78%, #c62828 100%)",
    short: "LR",
  },
  "Red Ripe": {
    swatch:
      "linear-gradient(135deg, #e53935 0%, #c62828 50%, #b71c1c 100%)",
    short: "RR",
  },
};

export const MATURITY_ORDER = [
  "Breaker",
  "Turning",
  "Pink",
  "Light Red",
  "Red Ripe",
] as const;

export const FARMER_MATURITY_OPTIONS = MATURITY_ORDER.map((value) => ({
  value,
  swatch: MATURITY_SWATCHES[value]?.swatch ?? "#ccc",
}));
