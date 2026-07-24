import { Keypair } from '@stellar/stellar-sdk';
import config from '../config';

const _keypair: Keypair = (() => {
  const secret = config.platformSecretKey;
  try {
    return Keypair.fromSecret(secret);
  } catch {
    throw new Error('PLATFORM_SECRET_KEY is invalid — must be a valid Stellar secret key');
  }
})();

export function getPlatformKeypair(): Keypair {
  return _keypair;
}
