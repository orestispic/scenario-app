import type { SessionTokens } from "./contractsV2";

export interface AuthAdapter {
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signIn(email: string, password: string): Promise<SessionTokens>;
  refreshSession(refreshToken: string): Promise<SessionTokens>;
  requestPasswordReset(email: string): Promise<void>;
  sendCloudRecoveryLink(email: string, redirectTo: string): Promise<void>;
  changeEmail(currentEmail: string, currentPassword: string, newEmail: string): Promise<SessionTokens>;
  updatePassword(currentEmail: string, currentPassword: string, newPassword: string): Promise<SessionTokens>;
}

export const ACCOUNT_PASSWORD_MIN_LENGTH = 12;
export const ACCOUNT_PASSWORD_MAX_LENGTH = 128;
export const ACCOUNT_DISPLAY_NAME_MAX_LENGTH = 120;
export const ACCOUNT_EMAIL_MAX_LENGTH = 254;
export const ACCOUNT_AUTH_TIMEOUT_MS = 15_000;

type SupabaseSessionResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
};

export class AuthSessionError extends Error {
  constructor(
    message: string,
    readonly terminal: boolean,
  ) {
    super(message);
  }
}

export function normalizeAccountEmail(email: string): string {
  const normalizedEmail = email.trim().toLowerCase();
  if (
    !normalizedEmail ||
    normalizedEmail.length > ACCOUNT_EMAIL_MAX_LENGTH ||
    /[\s\u0000-\u001f\u007f]/u.test(normalizedEmail) ||
    !/^[^@]+@[^@]+\.[^@]+$/u.test(normalizedEmail)
  )
    throw new AuthSessionError('Saisissez une adresse e-mail valide.', false);
  return normalizedEmail;
}

export function validateSignUpInput(
  email: string,
  password: string,
  displayName: string,
): { email: string; password: string; displayName: string } {
  const normalizedEmail = normalizeAccountEmail(email);
  const normalizedDisplayName = displayName.trim();
  if (!normalizedDisplayName)
    throw new AuthSessionError('Saisissez un nom affiché.', false);
  if (normalizedDisplayName.length > ACCOUNT_DISPLAY_NAME_MAX_LENGTH)
    throw new AuthSessionError(`Le nom affiché ne peut pas dépasser ${ACCOUNT_DISPLAY_NAME_MAX_LENGTH} caractères.`, false);
  if (/[\u0000-\u001f\u007f]/u.test(normalizedDisplayName))
    throw new AuthSessionError('Le nom affiché contient un caractère de contrôle interdit.', false);
  if (password.length < ACCOUNT_PASSWORD_MIN_LENGTH)
    throw new AuthSessionError(`Le mot de passe doit contenir au moins ${ACCOUNT_PASSWORD_MIN_LENGTH} caractères.`, false);
  if (password.length > ACCOUNT_PASSWORD_MAX_LENGTH)
    throw new AuthSessionError(`Le mot de passe ne peut pas dépasser ${ACCOUNT_PASSWORD_MAX_LENGTH} caractères.`, false);
  if (/[\u0000-\u001f\u007f]/u.test(password))
    throw new AuthSessionError('Le mot de passe contient un caractère de contrôle interdit.', false);
  return { email: normalizedEmail, password, displayName: normalizedDisplayName };
}

export function validatePasswordChange(
  currentPassword: string,
  newPassword: string,
  confirmation: string,
): void {
  if (!currentPassword) throw new AuthSessionError('Saisissez votre mot de passe actuel.', false);
  if (newPassword !== confirmation) throw new AuthSessionError('Les deux nouveaux mots de passe ne correspondent pas.', false);
  if (newPassword === currentPassword) throw new AuthSessionError('Le nouveau mot de passe doit être différent du mot de passe actuel.', false);
  if (newPassword.length < ACCOUNT_PASSWORD_MIN_LENGTH)
    throw new AuthSessionError(`Le nouveau mot de passe doit contenir au moins ${ACCOUNT_PASSWORD_MIN_LENGTH} caractères.`, false);
  if (newPassword.length > ACCOUNT_PASSWORD_MAX_LENGTH)
    throw new AuthSessionError(`Le nouveau mot de passe ne peut pas dépasser ${ACCOUNT_PASSWORD_MAX_LENGTH} caractères.`, false);
  if (/[\u0000-\u001f\u007f]/u.test(newPassword))
    throw new AuthSessionError('Le nouveau mot de passe contient un caractère de contrôle interdit.', false);
}

function safeAccountSiteUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Adresse publique du compte invalide.');
  }
  const localDevelopment = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !localDevelopment) || url.username || url.password || url.search || url.hash)
    throw new Error('Adresse publique du compte invalide.');
  return url;
}

async function safeAuthError(
  response: Response,
  fallback: string,
  terminalStatuses: readonly number[] = [400, 401, 403],
): Promise<AuthSessionError> {
  let hint = '';
  try {
    const payload = await response.clone().json() as Record<string, unknown>;
    hint = `${String(payload.code ?? payload.error_code ?? '')} ${String(payload.message ?? payload.msg ?? payload.error_description ?? '')}`.toLocaleLowerCase('en-US');
  } catch { /* Status and the operation-specific fallback remain authoritative. */ }

  let message = fallback;
  if (response.status === 429 || /rate.?limit|too many requests/u.test(hint))
    message = 'Trop de demandes ont été envoyées. Réessayez dans quelques minutes.';
  else if (/already|registered|exists|unique|email_exists|user_already_exists/u.test(hint))
    message = 'Cette adresse e-mail est déjà utilisée par un autre compte.';
  else if (/invalid.*(login|credential|password)|bad.*password/u.test(hint))
    message = 'Adresse e-mail ou mot de passe incorrect.';
  else if (/email.*not.*confirm|email_not_confirmed/u.test(hint))
    message = 'Confirmez votre adresse e-mail avant de vous connecter.';
  else if (/weak|pwned|compromised|password.*short/u.test(hint))
    message = 'Ce mot de passe est trop faible ou figure dans une fuite connue. Choisissez-en un autre.';
  else if (/same_password/u.test(hint))
    message = 'Le nouveau mot de passe doit être différent du mot de passe actuel.';
  else if (/refresh.*(expired|invalid|missing|reuse)|session.*(expired|invalid|missing)/u.test(hint))
    message = 'La session a expiré. Reconnectez-vous.';
  else if (response.status >= 500)
    message = 'Le service de compte est temporairement indisponible. Réessayez plus tard.';

  return new AuthSessionError(message, terminalStatuses.includes(response.status));
}

export function createSupabaseAuthAdapter(options: {
  supabaseUrl: string;
  anonKey: string;
  accountSiteUrl: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): AuthAdapter {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.supabaseUrl.replace(/\/$/, "");
  const accountSiteUrl = safeAccountSiteUrl(options.accountSiteUrl);
  const timeoutMs = options.timeoutMs ?? ACCOUNT_AUTH_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error('Délai du service de compte invalide.');
  const accountRedirect = (path: '/connexion' | '/reinitialisation') =>
    new URL(path, accountSiteUrl).toString();
  async function authFetch(input: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(
      () => controller.abort(new DOMException('Authentication request timed out.', 'TimeoutError')),
      timeoutMs,
    );
    try {
      return await fetcher(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (
        controller.signal.aborted ||
        error instanceof TypeError ||
        (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name))
      )
        throw new AuthSessionError('Connexion au service de compte impossible. Vérifiez votre réseau puis réessayez.', false);
      throw error;
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
  async function post(path: string, body: unknown): Promise<Response> {
    const response = await authFetch(`${baseUrl}/auth/v1${path}`, {
      method: "POST",
      headers: { apikey: options.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw await safeAuthError(response, 'Le service de compte a refusé la demande.');
    return response;
  }

  async function updateEmail(accessToken: string, email: string): Promise<void> {
    const response = await authFetch(`${baseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: options.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    if (response.ok) return;
    throw await safeAuthError(response, 'Le changement d’adresse e-mail a été refusé.', [400, 401, 403, 422]);
  }
  async function updateUserPassword(accessToken: string, password: string): Promise<void> {
    const response = await authFetch(`${baseUrl}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: options.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    });
    if (response.ok) return;
    throw await safeAuthError(response, 'Le changement de mot de passe a été refusé.', [400, 401, 403, 422]);
  }
  async function readSession(response: Response): Promise<SessionTokens> {
    const result = (await response.json()) as SupabaseSessionResponse;
    if (!result.access_token || !result.refresh_token || !result.expires_at)
      throw new Error("Session incomplète.");
    return {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: new Date(result.expires_at * 1_000).toISOString(),
    };
  }
  return {
    async signUp(email, password, displayName) {
      const valid = validateSignUpInput(email, password, displayName);
      await post(`/signup?redirect_to=${encodeURIComponent(accountRedirect('/connexion'))}`, {
        email: valid.email,
        password: valid.password,
        data: { display_name: valid.displayName },
      });
    },
    async signIn(email, password) {
      return readSession(await post("/token?grant_type=password", {
        email: normalizeAccountEmail(email),
        password,
      }));
    },
    async refreshSession(refreshToken) {
      return readSession(
        await post("/token?grant_type=refresh_token", { refresh_token: refreshToken }),
      );
    },
    async requestPasswordReset(email) {
      await post(`/recover?redirect_to=${encodeURIComponent(accountRedirect('/reinitialisation'))}`, {
        email: normalizeAccountEmail(email),
      });
    },
    async sendCloudRecoveryLink(email, redirectTo) {
      const destination = new URL(redirectTo);
      if (
        (destination.protocol !== 'https:' && !(destination.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(destination.hostname))) ||
        destination.username || destination.password || destination.hash
      ) {
        throw new Error('Adresse de récupération Cloud invalide.');
      }
      await post(`/otp?redirect_to=${encodeURIComponent(destination.toString())}`, {
        email: normalizeAccountEmail(email),
        create_user: false,
      });
    },
    async changeEmail(currentEmail, currentPassword, newEmail) {
      const session = await readSession(await post('/token?grant_type=password', {
        email: normalizeAccountEmail(currentEmail),
        password: currentPassword,
      }));
      await updateEmail(session.accessToken, normalizeAccountEmail(newEmail));
      return session;
    },
    async updatePassword(currentEmail, currentPassword, newPassword) {
      validatePasswordChange(currentPassword, newPassword, newPassword);
      let session: SessionTokens;
      try {
        session = await readSession(await post('/token?grant_type=password', {
          email: normalizeAccountEmail(currentEmail),
          password: currentPassword,
        }));
      } catch (error) {
        if (error instanceof AuthSessionError && error.message === 'Adresse e-mail ou mot de passe incorrect.')
          throw new AuthSessionError('Le mot de passe actuel est incorrect.', error.terminal);
        throw error;
      }
      await updateUserPassword(session.accessToken, newPassword);
      return session;
    },
  };
}

/** Local identity selector. Rights are always fetched from the separate local Worker. */
export interface LocalTestAuthAdapter extends AuthAdapter {
  signInAs(profile: "discovery" | "author" | "studio"): Promise<SessionTokens>;
}

export function createLocalTestAuthAdapter(): LocalTestAuthAdapter {
  return {
    signUp: async () => {
      throw new Error("Inscription locale désactivée.");
    },
    signIn: async () => {
      throw new Error("Choisissez un profil local.");
    },
    refreshSession: async (token) => {
      if (!/^local-test:(discovery|author|studio)$/.test(token))
        throw new AuthSessionError("Session locale invalide.", true);
      return {
        accessToken: token,
        refreshToken: token,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      };
    },
    requestPasswordReset: async () => {
      throw new Error("Récupération locale désactivée.");
    },
    sendCloudRecoveryLink: async () => {
      throw new Error("Lien de récupération Cloud indisponible en mode local.");
    },
    changeEmail: async () => {
      throw new Error("Changement d’adresse indisponible en mode local.");
    },
    updatePassword: async () => {
      throw new Error("Changement de mot de passe indisponible en mode local.");
    },
    signInAs: async (profile) => ({
      accessToken: `local-test:${profile}`,
      refreshToken: `local-test:${profile}`,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  };
}
