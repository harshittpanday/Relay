export type EmojiSize = 'one' | 'few' | 'several';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const emojiSignal =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\u20e3]/u;
const emojiPart =
  /\p{Emoji}|\p{Emoji_Component}|\p{Mark}|\u200d|\ufe0e|\ufe0f|[\u{e0020}-\u{e007f}]/u;

export function emojiSize(text: string): EmojiSize | null {
  let count = 0;
  for (const { segment } of graphemes.segment(text)) {
    if (/^\s+$/u.test(segment)) continue;
    // The outer segment is one visible emoji; inspect its code points only to reject embedded text.
    if (
      !emojiSignal.test(segment) ||
      Array.from(segment).some((part) => !emojiPart.test(part))
    )
      return null;
    count += 1;
    if (count > 6) return null;
  }
  if (count === 1) return 'one';
  if (count <= 3 && count > 1) return 'few';
  if (count <= 6 && count > 3) return 'several';
  return null;
}
