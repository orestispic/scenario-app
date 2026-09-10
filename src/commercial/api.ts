import {
  type AccountOverview,
  type CommercialApi,
  CommercialContractError,
  parseAccountOverview,
} from "./contracts";

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface HttpTransport {
  get(path: string): Promise<HttpResponse>;
}

export function createHttpCommercialApi(transport: HttpTransport): CommercialApi {
  return {
    async getAccountOverview(): Promise<AccountOverview> {
      const response = await transport.get("/api/v1/me/account-overview");
      if (!response.ok) {
        throw new CommercialContractError(`Impossible de lire le compte (${response.status}).`);
      }
      return parseAccountOverview(await response.json());
    },
  };
}

export function createFetchTransport(baseUrl: string, fetcher: typeof fetch = fetch): HttpTransport {
  const normalizedBaseUrl = new URL(baseUrl).toString();
  return {
    get(path) {
      return fetcher(new URL(path, normalizedBaseUrl), {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
    },
  };
}
