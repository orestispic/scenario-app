import { AuthSessionError, type AuthAdapter } from './auth';
import { CommercialHttpError } from './authenticatedApi';
import type { SessionTokens } from './contractsV2';
import type { PendingAccountClosure } from './pendingAccountClosure';

export const ACCOUNT_CLOSURE_CONFIRMATION = 'CLOSE_MY_ACCOUNT';

export interface AccountClosureDependencies {
  auth: Pick<AuthAdapter, 'signIn'>;
  checkLocalSafety(): Promise<void>;
  acceptSession(session: SessionTokens): Promise<unknown>;
  confirmIrreversible(): Promise<boolean>;
  createVerificationToken(): string;
  persistPending(value: PendingAccountClosure): Promise<void>;
  clearPending(): Promise<void>;
  closeRemote(verificationToken: string): Promise<void>;
  verifyRemote(verificationToken: string): Promise<{ closed: boolean }>;
  purgeLocal(): Promise<void>;
}

export class AccountClosureUncertainError extends AuthSessionError {
  constructor(
    readonly verificationToken: string,
    readonly accountId: string,
  ) {
    super(
      'La clôture ou son nettoyage local est impossible à confirmer immédiatement. Ne renvoyez pas la demande : utilisez uniquement le reçu enregistré sur cet appareil.',
      false,
    );
  }
}

function needsRemoteVerification(error: unknown): boolean {
  return error instanceof TypeError ||
    (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) ||
    (error instanceof CommercialHttpError && error.status >= 500);
}

export function isAccountClosureResultUncertain(error: unknown): boolean {
  return error instanceof AccountClosureUncertainError;
}

export async function runAccountClosure(
  input: {
    accountId: string;
    email: string;
    currentPassword: string;
    confirmation: string;
    /**
     * Reuse the durable receipt after an earlier response was lost. Replaying
     * the same receipt is safe because the server serializes closure per
     * account and binds the first committed transaction to that receipt.
     */
    pending?: PendingAccountClosure | null;
  },
  dependencies: AccountClosureDependencies,
): Promise<boolean> {
  if (!input.currentPassword)
    throw new AuthSessionError('Saisissez votre mot de passe actuel.', false);
  if (input.confirmation !== ACCOUNT_CLOSURE_CONFIRMATION)
    throw new AuthSessionError(`Recopiez exactement ${ACCOUNT_CLOSURE_CONFIRMATION} pour continuer.`, false);
  await dependencies.checkLocalSafety();
  if (!await dependencies.confirmIrreversible()) return false;

  const freshSession = await dependencies.auth.signIn(input.email, input.currentPassword);
  await dependencies.acceptSession(freshSession);
  if (input.pending && input.pending.accountId !== input.accountId)
    throw new AuthSessionError('Ce reçu de clôture appartient à un autre compte.', false);
  const verificationToken = input.pending?.verificationToken ?? dependencies.createVerificationToken();
  if (!input.pending) {
    await dependencies.persistPending({
      schemaVersion: 1,
      accountId: input.accountId,
      verificationToken,
      createdAt: new Date().toISOString(),
    });
  }
  try {
    await dependencies.closeRemote(verificationToken);
  } catch (error) {
    if (!needsRemoteVerification(error)) {
      await dependencies.clearPending();
      throw error;
    }
    try {
      // Exactly one read-only verification is allowed. Never replay the
      // irreversible POST after a transport failure.
      const status = await dependencies.verifyRemote(verificationToken);
      if (status.closed) {
        await dependencies.purgeLocal();
        await dependencies.clearPending();
        return true;
      }
    } catch {
      throw new AccountClosureUncertainError(verificationToken, input.accountId);
    }
    // An unknown receipt immediately after a lost response does not prove the
    // close transaction failed: the original request can still be committing.
    // Keep the durable receipt and require a later read-only verification.
    throw new AccountClosureUncertainError(verificationToken, input.accountId);
  }
  try {
    await dependencies.purgeLocal();
    await dependencies.clearPending();
  } catch {
    throw new AccountClosureUncertainError(verificationToken, input.accountId);
  }
  return true;
}

export function createAccountClosureVerificationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

export function accountClosureErrorMessage(error: unknown): string {
  if (error instanceof AuthSessionError) return error.message;
  if (
    error instanceof TypeError ||
    (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
  )
    return 'Le résultat de la clôture est impossible à confirmer. Ne renvoyez pas la demande : vérifiez d’abord votre accès au compte et le dernier e-mail reçu.';
  if (error instanceof CommercialHttpError) {
    const reference = error.requestId ? ` Référence : ${error.requestId}.` : '';
    if (error.code === 'account_subscription_active')
      return `Un abonnement peut encore être renouvelé ou débité. Résiliez-le depuis la facturation, puis attendez sa confirmation avant de clôturer le compte. Votre compte reste ouvert.${reference}`;
    if (error.status === 400)
      return `La demande de clôture est invalide. Votre compte reste ouvert.${reference}`;
    if (error.status === 401)
      return `La session a expiré. Votre compte reste ouvert ; reconnectez-vous.${reference}`;
    if (error.status === 403)
      return `La clôture n’est pas autorisée pour ce compte. Le compte reste ouvert.${reference}`;
    if (error.status === 409)
      return `La clôture ne peut pas démarrer dans l’état actuel du compte. Le compte reste ouvert.${reference}`;
    if (error.status === 429)
      return `Trop de demandes ont été envoyées. Votre compte reste ouvert ; réessayez plus tard.${reference}`;
    if (error.status >= 500)
      return `Le service de clôture est temporairement indisponible. Votre compte reste ouvert.${reference}`;
    return `La clôture a été refusée. Votre compte reste ouvert.${reference}`;
  }
  return 'La clôture n’a pas pu être confirmée. Votre compte reste ouvert.';
}
