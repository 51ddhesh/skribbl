// server/scoreManager.ts

export interface ScoreResult {
  guesserPoints: number;
  drawerPoints: number;
  isFirstGuess: boolean;
}

export function calculateGuessScore(
  timeElapsed: number,
  totalTime: number,
  correctGuessCount: number  // how many have already guessed correctly (before this player)
): ScoreResult {
  // Guesser gets more points for faster guesses
  // Range: ~500 (instant) to ~100 (last second)
  const timeRatio = 1 - timeElapsed / totalTime;
  const guesserPoints = Math.round(100 + 400 * timeRatio);

  // First guess bonus
  const isFirstGuess = correctGuessCount === 0;
  const firstGuessBonus = isFirstGuess ? 100 : 0;

  // Drawer gets points per correct guesser
  const drawerPoints = 50;

  return {
    guesserPoints: guesserPoints + firstGuessBonus,
    drawerPoints,
    isFirstGuess,
  };
}