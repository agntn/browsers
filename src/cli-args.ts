const passthroughFirstArgs = new Set([
  'scrape',
  'screenshot',
  'session',
  'providers',
])

const helpOrVersionFlags = new Set([
  '-h',
  '--help',
  '-v',
  '--version',
])

export function normalizeMainArgs(rawArgs: string[]): string[] {
  const [firstArg] = rawArgs
  if (!firstArg) return rawArgs
  if (passthroughFirstArgs.has(firstArg) || helpOrVersionFlags.has(firstArg)) return rawArgs
  return ['scrape', ...rawArgs]
}
