import type { SessionTokens } from "./contractsV2";

export interface AuthAdapter {
  signUp(email: string, password: string, displayName: string): Promise<void>;
  signIn(email: string, password: string): Promise<SessionTokens>;
  refreshSession(refreshToken: string): Promise<SessionTokens>;
  requestPasswordReset(email: string): Promise<void>;
}

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

export function createSupabaseAuthAdapter(options: {
  supabaseUrl: string;
  anonKey: string;
  fetcher?: typeof fetch;
}): AuthAdapter {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.supabaseUrl.replace(/\/$/, "");
  async function post(path: string, body: unknown): Promise<Response> {
    const response = await fetcher(`${baseUrl}/auth/v1${path}`, {
      method: "POST",
      headers: { apikey: options.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new AuthSessionError(
        "Le service de compte a refusé la demande.",
        [400, 401, 403].includes(response.status),
      );
    return response;
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
      await post("/signup", { email, password, data: { display_name: displayName } });
    },
    async signIn(email, password) {
      return readSession(await post("/token?grant_type=password", { email, password }));
    },
    async refreshSession(refreshToken) {
      return readSession(
        await post("/token?grant_type=refresh_token", { refresh_token: refreshToken }),
      );
    },
    async requestPasswordReset(email) {
      await post("/recover", { email });
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
    signInAs: async (profile) => ({
      accessToken: `local-test:${profile}`,
      refreshToken: `local-test:${profile}`,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  };
}
