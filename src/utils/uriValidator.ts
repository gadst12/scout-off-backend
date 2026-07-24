/**
 * Evidence URI validation helper.
 * Accepts: ipfs://, https://
 * Rejects: http://, plain strings, empty/non-string values
 */
export function isValidEvidenceUri(uri: string): boolean {
  if (!uri || typeof uri !== 'string') return false;
  return uri.startsWith('ipfs://') || uri.startsWith('https://');
}
