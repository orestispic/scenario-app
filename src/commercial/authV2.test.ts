import { describe, expect, it, vi } from "vitest";
import {
  ACCOUNT_PASSWORD_MAX_LENGTH,
  ACCOUNT_PASSWORD_MIN_LENGTH,
  ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
  ACCOUNT_EMAIL_MAX_LENGTH,
  AuthSessionError,
  createSupabaseAuthAdapter,
  normalizeAccountEmail,
  validatePasswordChange,
  validateSignUpInput,
} from "./auth";
import type { EntitlementSnapshot } from "./contracts";
import type { OfflineGrantPayload, SignedOfflineGrant } from "./contractsV2";
import { verifyOfflineGrant } from "./signedEntitlementCache";

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signedFixture(expiresAt: string) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const payload: OfflineGrantPayload = {
    userId: "user-test",
    deviceId: null,
    snapshotId: "snapshot-test",
    configurationVersion: "configuration-test",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt,
  };
  const encodedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new TextEncoder().encode(encodedPayload));
  const grant: SignedOfflineGrant = {
    format: "scenario.offline-grant.v1",
    algorithm: "ES256",
    keyId: "test-key",
    payload: encodedPayload,
    signature: encodeBase64Url(new Uint8Array(signature)),
  };
  const snapshot: EntitlementSnapshot = {
    id: "snapshot-test",
    configurationVersion: "configuration-test",
    issuedAt: payload.issuedAt,
    offlineValidUntil: expiresAt,
    entitlements: [],
  };
  return { grant, snapshot, publicKey: await crypto.subtle.exportKey("jwk", pair.publicKey) };
}

describe("session Supabase", () => {
  it("envoie l'inscription au service d'authentification sans créer de session locale implicite", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid/",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json({ user: { id: "pending-confirmation" }, session: null });
      },
    });

    await expect(adapter.signUp("writer@example.invalid", "not-a-real-password", "Camille"))
      .resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://project.example.invalid/auth/v1/signup?redirect_to=https%3A%2F%2Fsenario.app%2Fconnexion");
    expect(requests[0]!.init?.method).toBe("POST");
    expect(new Headers(requests[0]!.init?.headers).get("apikey")).toBe("public-test-key");
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      email: "writer@example.invalid",
      password: "not-a-real-password",
      data: { display_name: "Camille" },
    });
  });

  it("normalise l'inscription et refuse les champs invalides avant tout appel réseau", async () => {
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return Response.json({ user: { id: 'pending-confirmation' } });
    });
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: 'https://project.example.invalid',
      anonKey: 'public-test-key',
      accountSiteUrl: 'https://senario.app/',
      fetcher,
    });

    await adapter.signUp('  Writer@Example.Invalid  ', 'a-secure-password', '  Camille  ');
    expect(JSON.parse(bodies[0]!)).toEqual({
      email: 'writer@example.invalid',
      password: 'a-secure-password',
      data: { display_name: 'Camille' },
    });

    const invalidInputs = [
      ['', 'a-secure-password', 'Camille'],
      ['not-an-email', 'a-secure-password', 'Camille'],
      [`writer@${'x'.repeat(ACCOUNT_EMAIL_MAX_LENGTH)}.test`, 'a-secure-password', 'Camille'],
      ['writer@example.invalid', 'short', 'Camille'],
      ['writer@example.invalid', 'x'.repeat(ACCOUNT_PASSWORD_MAX_LENGTH + 1), 'Camille'],
      ['writer@example.invalid', 'a-secure-password', '   '],
      ['writer@example.invalid', 'a-secure-password', 'x'.repeat(ACCOUNT_DISPLAY_NAME_MAX_LENGTH + 1)],
      ['writer@example.invalid', 'a-secure-password', 'Camille\nAdmin'],
    ] as const;
    for (const [email, password, displayName] of invalidInputs)
      await expect(adapter.signUp(email, password, displayName)).rejects.toBeInstanceOf(AuthSessionError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('expose une validation pure sans conserver les informations saisies', () => {
    expect(validateSignUpInput(' User@Example.Test ', 'a-secure-password', '  Nom public ')).toEqual({
      email: 'user@example.test',
      password: 'a-secure-password',
      displayName: 'Nom public',
    });
    expect(() => validateSignUpInput('user@example.test', 'valid-password\n', 'Nom public')).toThrow('contrôle');
    expect(normalizeAccountEmail('  User@Example.Test ')).toBe('user@example.test');
    expect(() => normalizeAccountEmail('not-an-email')).toThrow('valide');
  });

  it('normalise et valide les e-mails sur tous les parcours avant le réseau', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: 'https://project.example.invalid',
      anonKey: 'public-test-key',
      accountSiteUrl: 'https://senario.app/',
      fetcher: async (input, init) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        requests.push({ url: String(input), body });
        if (String(input).includes('/token?grant_type=password'))
          return Response.json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: 1_900_000_000 });
        return Response.json({ ok: true });
      },
    });

    await adapter.signIn('  Login@Example.Test ', 'unchanged-password');
    await adapter.requestPasswordReset('  Reset@Example.Test ');
    await adapter.sendCloudRecoveryLink(' Cloud@Example.Test ', 'https://senario.app/?cloud-recovery=1');
    await adapter.changeEmail(' Old@Example.Test ', 'unchanged-password', ' New@Example.Test ');

    expect(requests[0]?.body).toMatchObject({ email: 'login@example.test', password: 'unchanged-password' });
    expect(requests[1]?.body).toEqual({ email: 'reset@example.test' });
    expect(requests[2]?.body).toMatchObject({ email: 'cloud@example.test' });
    expect(requests[3]?.body).toMatchObject({ email: 'old@example.test', password: 'unchanged-password' });
    expect(requests[4]?.body).toEqual({ email: 'new@example.test' });
    const callCount = requests.length;
    await expect(adapter.requestPasswordReset('invalid')).rejects.toBeInstanceOf(AuthSessionError);
    await expect(adapter.signIn(`x@${'y'.repeat(ACCOUNT_EMAIL_MAX_LENGTH)}.test`, 'unchanged-password')).rejects.toBeInstanceOf(AuthSessionError);
    expect(requests).toHaveLength(callCount);
  });

  it("construit une session courte depuis la réponse authentifiée", async () => {
    const requests: string[] = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async (input) => {
        requests.push(String(input));
        return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_at: 1_900_000_000 }), { status: 200 });
      },
    });
    const session = await adapter.signIn("writer@example.invalid", "not-a-real-password");
    expect(session.accessToken).toBe("access");
    expect(session.refreshToken).toBe("refresh");
    expect(requests[0]).toContain("grant_type=password");
    await adapter.refreshSession(session.refreshToken);
    expect(requests[1]).toContain("grant_type=refresh_token");
  });

  it("refuse une réponse de connexion sans les trois éléments de session", async () => {
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async () => Response.json({ access_token: "access-only" }),
    });

    await expect(adapter.signIn("writer@example.invalid", "not-a-real-password"))
      .rejects.toThrow("Session incomplète");
  });

  it("demande un e-mail de récupération sans envoyer de mot de passe ni créer de session", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(null, { status: 200 });
      },
    });

    await expect(adapter.requestPasswordReset("writer@example.invalid")).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://project.example.invalid/auth/v1/recover?redirect_to=https%3A%2F%2Fsenario.app%2Freinitialisation");
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({ email: "writer@example.invalid" });
  });

  it("refuse une destination de compte non sécurisée mais autorise localhost en développement", () => {
    expect(() => createSupabaseAuthAdapter({
      supabaseUrl: 'https://project.example.invalid',
      anonKey: 'public-test-key',
      accountSiteUrl: 'http://example.invalid/',
    })).toThrow('Adresse publique du compte invalide');
    expect(() => createSupabaseAuthAdapter({
      supabaseUrl: 'https://project.example.invalid',
      anonKey: 'public-test-key',
      accountSiteUrl: 'http://127.0.0.1:3000/',
    })).not.toThrow();
  });

  it("interrompt une requête Supabase suspendue et expose une erreur réseau non terminale", async () => {
    vi.useFakeTimers();
    try {
      let capturedSignal: AbortSignal | undefined;
      const adapter = createSupabaseAuthAdapter({
        supabaseUrl: 'https://project.example.invalid',
        anonKey: 'public-test-key',
        accountSiteUrl: 'https://senario.app/',
        timeoutMs: 25,
        fetcher: async (_input, init) => new Promise<Response>((_resolve, reject) => {
          capturedSignal = init?.signal ?? undefined;
          capturedSignal?.addEventListener('abort', () => reject(capturedSignal?.reason), { once: true });
        }),
      });

      const request = adapter.signIn('writer@example.invalid', 'not-a-real-password');
      const assertion = expect(request).rejects.toMatchObject({
        terminal: false,
        message: 'Connexion au service de compte impossible. Vérifiez votre réseau puis réessayez.',
      });
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
      expect(capturedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("convertit une TypeError réseau sans en révéler le détail", async () => {
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: 'https://project.example.invalid',
      anonKey: 'public-test-key',
      accountSiteUrl: 'https://senario.app/',
      fetcher: async () => { throw new TypeError('socket failure with private provider details'); },
    });

    let failure: unknown;
    try { await adapter.signIn('writer@example.invalid', 'not-a-real-password'); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({
      terminal: false,
      message: 'Connexion au service de compte impossible. Vérifiez votre réseau puis réessayez.',
    });
    expect((failure as Error).message).not.toContain('private provider details');
  });

  it("ne révèle jamais un message fournisseur ou SQL arbitraire", async () => {
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: 'https://project.example.invalid',
      anonKey: 'public-test-key',
      accountSiteUrl: 'https://senario.app/',
      fetcher: async () => Response.json({
        code: 'database_error',
        message: 'SQLSTATE 42P01 relation private_users_internal does not exist',
      }, { status: 500 }),
    });

    let failure: unknown;
    try { await adapter.signIn('writer@example.invalid', 'not-a-real-password'); }
    catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(AuthSessionError);
    expect(failure).toMatchObject({
      terminal: false,
      message: 'Le service de compte est temporairement indisponible. Réessayez plus tard.',
    });
    expect((failure as Error).message).not.toMatch(/SQLSTATE|private_users_internal/u);
  });

  it("réauthentifie le compte avant de demander un changement d’adresse", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        if (String(input).includes('grant_type=password')) {
          return Response.json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: 1_900_000_000 });
        }
        return Response.json({ email: 'new@example.invalid' });
      },
    });
    await adapter.changeEmail('old@example.invalid', 'current-password', 'new@example.invalid');
    expect(requests).toHaveLength(2);
    expect(requests[0]!.url).toContain('grant_type=password');
    expect(requests[1]).toMatchObject({ url: 'https://project.example.invalid/auth/v1/user', init: { method: 'PUT' } });
    expect(new Headers(requests[1]!.init?.headers).get('Authorization')).toBe('Bearer fresh-access');
  });

  it("affiche une erreur claire si la nouvelle adresse est déjà utilisée", async () => {
    let calls = 0;
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async () => ++calls === 1
        ? Response.json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: 1_900_000_000 })
        : Response.json({ message: 'email already registered' }, { status: 422 }),
    });
    await expect(adapter.changeEmail('old@example.invalid', 'current-password', 'used@example.invalid'))
      .rejects.toThrow('déjà utilisée');
  });

  it("n'envoie jamais le changement d'adresse si la réauthentification échoue", async () => {
    const requests: string[] = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async (input) => {
        requests.push(String(input));
        return Response.json({ message: "Invalid login credentials" }, { status: 400 });
      },
    });

    await expect(adapter.changeEmail("old@example.invalid", "wrong-password", "new@example.invalid"))
      .rejects.toThrow();
    expect(requests).toEqual([
      "https://project.example.invalid/auth/v1/token?grant_type=password",
    ]);
  });

  it("réauthentifie le compte avant de modifier le mot de passe", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        if (String(input).includes('grant_type=password'))
          return Response.json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: 1_900_000_000 });
        return Response.json({ id: 'user-test' });
      },
    });

    await adapter.updatePassword('writer@example.invalid', 'current-password', 'a-new-long-password');
    expect(requests).toHaveLength(2);
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({
      email: 'writer@example.invalid',
      password: 'current-password',
    });
    expect(requests[1]).toMatchObject({
      url: 'https://project.example.invalid/auth/v1/user',
      init: { method: 'PUT' },
    });
    expect(new Headers(requests[1]!.init?.headers).get('Authorization')).toBe('Bearer fresh-access');
    expect(JSON.parse(String(requests[1]!.init?.body))).toEqual({ password: 'a-new-long-password' });
  });

  it("n'envoie aucun PUT de mot de passe si la réauthentification échoue", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), init });
        return Response.json({ message: 'Invalid login credentials' }, { status: 400 });
      },
    });

    await expect(adapter.updatePassword('writer@example.invalid', 'wrong-password', 'a-new-long-password'))
      .rejects.toThrow('mot de passe actuel est incorrect');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toContain('grant_type=password');
  });

  it("ne révèle pas une erreur interne renvoyée pendant le PUT du mot de passe", async () => {
    let calls = 0;
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: 'https://project.example.invalid',
      anonKey: 'public-test-key',
      accountSiteUrl: 'https://senario.app/',
      fetcher: async () => ++calls === 1
        ? Response.json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_at: 1_900_000_000 })
        : Response.json({ message: 'SQLSTATE private credential column exposed' }, { status: 400 }),
    });

    let failure: unknown;
    try { await adapter.updatePassword('writer@example.invalid', 'current-password', 'a-new-long-password'); }
    catch (error) { failure = error; }
    expect(failure).toMatchObject({
      terminal: true,
      message: 'Le changement de mot de passe a été refusé.',
    });
    expect((failure as Error).message).not.toMatch(/SQLSTATE|credential column/u);
  });

  it("valide strictement le nouveau mot de passe et sa confirmation avant tout appel", () => {
    expect(() => validatePasswordChange('', 'a-new-long-password', 'a-new-long-password')).toThrow('actuel');
    expect(() => validatePasswordChange('current-password', 'a-new-long-password', 'different-password')).toThrow('correspondent');
    expect(() => validatePasswordChange('same-long-password', 'same-long-password', 'same-long-password')).toThrow('différent');
    expect(() => validatePasswordChange('current-password', 'short', 'short')).toThrow(`${ACCOUNT_PASSWORD_MIN_LENGTH}`);
    expect(() => validatePasswordChange('current-password', 'x'.repeat(ACCOUNT_PASSWORD_MAX_LENGTH + 1), 'x'.repeat(ACCOUNT_PASSWORD_MAX_LENGTH + 1))).toThrow(`${ACCOUNT_PASSWORD_MAX_LENGTH}`);
    expect(() => validatePasswordChange('current-password', 'valid-password\n', 'valid-password\n')).toThrow('contrôle');
    expect(() => validatePasswordChange('current-password', 'a-new-long-password', 'a-new-long-password')).not.toThrow();
  });

  it("envoie un magic-link de récupération sans pouvoir créer un compte", async () => {
    let capturedUrl = '';
    let capturedBody = '';
    const adapter = createSupabaseAuthAdapter({
      supabaseUrl: "https://project.example.invalid",
      anonKey: "public-test-key",
      accountSiteUrl: "https://senario.app/",
      fetcher: async (input, init) => {
        capturedUrl = String(input);
        capturedBody = String(init?.body ?? '');
        return new Response(null, { status: 200 });
      },
    });
    await adapter.sendCloudRecoveryLink('owner@example.invalid', 'https://senario.app/?cloud-recovery=1');
    expect(capturedUrl).toContain('/auth/v1/otp?redirect_to=');
    expect(JSON.parse(capturedBody)).toEqual({ email: 'owner@example.invalid', create_user: false });
  });
});

describe("cache hors ligne signé", () => {
  it("accepte une signature serveur valide", async () => {
    const fixture = await signedFixture("2026-01-08T00:00:00.000Z");
    await expect(verifyOfflineGrant(fixture.grant, fixture.publicKey, "test-key", fixture.snapshot, new Date("2026-01-02T00:00:00.000Z"))).resolves.toMatchObject({ snapshotId: "snapshot-test" });
  });

  it("refuse une charge modifiée ou expirée", async () => {
    const fixture = await signedFixture("2026-01-08T00:00:00.000Z");
    const tampered = { ...fixture.grant, payload: fixture.grant.payload.slice(0, -1) + "A" };
    await expect(verifyOfflineGrant(tampered, fixture.publicKey, "test-key", fixture.snapshot, new Date("2026-01-02T00:00:00.000Z"))).rejects.toThrow("Signature");
    await expect(verifyOfflineGrant(fixture.grant, fixture.publicKey, "test-key", fixture.snapshot, new Date("2026-01-09T00:00:00.000Z"))).rejects.toThrow("expiré");
  });
});
