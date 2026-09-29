/** Cuts a text at `max` code points with an ellipsis. */
export function clip(value: string, max: number): string {
  const points = [...value];
  return points.length > max
    ? `${points
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`
    : value;
}

const ONES = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/**
 * A count in words, `twenty` or `twenty-one`. Past ninety-nine, digits.
 *
 * @param count - A whole number.
 * @returns {string} The English word, lowercase.
 */
export function spellOut(count: number): string {
  if (!Number.isInteger(count) || count < 0 || count > 99) return String(count);
  if (count < 20) return ONES[count]!;
  const ones = count % 10;
  const tens = TENS[(count - ones) / 10]!;
  return ones === 0 ? tens : `${tens}-${ONES[ones]}`;
}

/**
 * The first letter upper case, for the start of a sentence.
 *
 * @param text - Any text.
 * @returns {string} The text with a capital.
 */
export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * `spellOut` for the start of a sentence: `Twenty`.
 *
 * @param count - A whole number.
 * @returns {string} The English word with a capital.
 */
export function spellOutCapital(count: number): string {
  return capitalize(spellOut(count));
}
