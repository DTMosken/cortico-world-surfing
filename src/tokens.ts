/** Adapted from Cortico src/protocol/open-responses/tokens.ts, MIT, Phantivia. */
export function estimateTokens(text: string): number {
  let weighted = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    weighted += ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3000 && code <= 0x30ff)
      || (code >= 0xff00 && code <= 0xffef)) ? 6 : 3;
  }
  return Math.ceil(weighted / 10);
}
