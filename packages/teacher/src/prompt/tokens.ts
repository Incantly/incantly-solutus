/** A token is counted as 4 characters for every budget (teacher design 5). */
export const CHARS_PER_TOKEN = 4;

export function tokensOf(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
