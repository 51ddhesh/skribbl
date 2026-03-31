// server/wordBank.ts

import wordsData from "./words.json";

const words: string[] = wordsData.words;

export function getRandomWords(count: number = 3): string[] {
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function generateHint(word: string, revealedIndices: number[]): string {
  return word
    .split("")
    .map((char, i) => {
      if (char === " ") return "  ";
      if (revealedIndices.includes(i)) return char;
      return "_";
    })
    .join(" ");
}

export function getNextHintIndex(word: string, alreadyRevealed: number[]): number {
  // Get indices of non-space characters that haven't been revealed
  const available = word
    .split("")
    .map((char, i) => ({ char, i }))
    .filter(({ char, i }) => char !== " " && !alreadyRevealed.includes(i))
    .map(({ i }) => i);

  if (available.length === 0) return -1;

  return available[Math.floor(Math.random() * available.length)]!;
}

