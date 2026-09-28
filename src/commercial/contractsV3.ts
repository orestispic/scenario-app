import { CommercialContractError, type EntitlementSnapshot } from "./contracts";

export const COMMERCIAL_CONTRACT_VERSION_V3 = "2026-09-v3";

export type BillingInterval = "month" | "year";
export type BillingStatus = "none" | "trialing" | "active" | "past_due" | "paused" | "canceled" | "expired";

export interface BillingOfferView {
  selectionId: string;
  offerCode: "author_ai" | "studio";
  displayName: string;
  description: string | null;
  billingInterval: BillingInterval;
  currency: string;
  unitAmountMinor: number;
  testMode: boolean;
}

export interface BillingState {
  status: BillingStatus;
  offerCode: string | null;
  offerDisplayName: string | null;
  billingInterval: BillingInterval | null;
  currentPeriodStartsAt: string | null;
  currentPeriodEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  lastPaymentStatus: "paid" | "failed" | null;
  source: "stripe" | "activation_key" | "admin_grant" | null;
  testMode: boolean;
}

export interface BillingOverviewResponse {
  offers: BillingOfferView[];
  billing: BillingState;
  request_id: string;
}

export interface CheckoutSessionRequest {
  selectionId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResponse {
  checkoutUrl: string;
  expiresAt: string;
  testMode: boolean;
  request_id: string;
}

export interface BillingPortalResponse {
  portalUrl: string;
  testMode: boolean;
  request_id: string;
}

function httpsUrl(value: unknown, label: string): string {
  const candidate = text(value, label)!;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || !url.hostname) throw new Error('invalid URL');
    return url.toString();
  } catch {
    throw new CommercialContractError(`${label} invalide.`);
  }
}

export function parseCheckoutSessionResponse(value: unknown): CheckoutSessionResponse {
  const raw = record(value, 'Session de paiement');
  if (typeof raw.testMode !== 'boolean')
    throw new CommercialContractError('Session de paiement invalide.');
  return {
    checkoutUrl: httpsUrl(raw.checkoutUrl, 'Adresse de paiement'),
    expiresAt: text(raw.expiresAt, 'Expiration de la session')!,
    testMode: raw.testMode,
    request_id: text(raw.request_id, 'Référence de paiement')!,
  };
}

export function parseBillingPortalResponse(value: unknown): BillingPortalResponse {
  const raw = record(value, 'Portail de facturation');
  if (typeof raw.testMode !== 'boolean')
    throw new CommercialContractError('Portail de facturation invalide.');
  return {
    portalUrl: httpsUrl(raw.portalUrl, 'Adresse du portail'),
    testMode: raw.testMode,
    request_id: text(raw.request_id, 'Référence du portail')!,
  };
}

export interface ActivationRedemptionView {
  id: string;
  keySuffix: string;
  status: "active" | "revoked" | "expired";
  activatedAt: string;
  expiresAt: string | null;
  deviceId: string | null;
}

export interface ActivationStatusResponse {
  activations: ActivationRedemptionView[];
  request_id: string;
}

export interface ActivationRedeemResponse {
  activation: ActivationRedemptionView;
  snapshot: EntitlementSnapshot;
  request_id: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CommercialContractError(`${label} invalide.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !value.trim())
    throw new CommercialContractError(`${label} invalide.`);
  return value;
}

function parseBillingState(value: unknown): BillingState {
  const raw = record(value, 'Facturation');
  const statuses: BillingStatus[] = ['none', 'trialing', 'active', 'past_due', 'paused', 'canceled', 'expired'];
  if (!statuses.includes(raw.status as BillingStatus) || typeof raw.cancelAtPeriodEnd !== 'boolean' || typeof raw.testMode !== 'boolean')
    throw new CommercialContractError('État de facturation invalide.');
  if (raw.billingInterval !== null && !['month', 'year'].includes(String(raw.billingInterval)))
    throw new CommercialContractError('Période de facturation invalide.');
  if (raw.lastPaymentStatus !== null && !['paid', 'failed'].includes(String(raw.lastPaymentStatus)))
    throw new CommercialContractError('État de paiement invalide.');
  if (raw.source !== null && !['stripe', 'activation_key', 'admin_grant'].includes(String(raw.source)))
    throw new CommercialContractError('Source de facturation invalide.');
  return {
    status: raw.status as BillingStatus,
    offerCode: text(raw.offerCode, 'Code de l’offre', true),
    offerDisplayName: text(raw.offerDisplayName, 'Nom de l’offre', true),
    billingInterval: raw.billingInterval as BillingInterval | null,
    currentPeriodStartsAt: text(raw.currentPeriodStartsAt, 'Début de période', true),
    currentPeriodEndsAt: text(raw.currentPeriodEndsAt, 'Fin de période', true),
    cancelAtPeriodEnd: raw.cancelAtPeriodEnd,
    lastPaymentStatus: raw.lastPaymentStatus as BillingState['lastPaymentStatus'],
    source: raw.source as BillingState['source'],
    testMode: raw.testMode,
  };
}

function parseActivation(value: unknown): ActivationRedemptionView {
  const raw = record(value, 'Activation');
  if (!['active', 'revoked', 'expired'].includes(String(raw.status)))
    throw new CommercialContractError('État d’activation invalide.');
  return {
    id: text(raw.id, 'Identifiant d’activation')!,
    keySuffix: text(raw.keySuffix, 'Suffixe de clé')!,
    status: raw.status as ActivationRedemptionView['status'],
    activatedAt: text(raw.activatedAt, 'Date d’activation')!,
    expiresAt: text(raw.expiresAt, 'Expiration d’activation', true),
    deviceId: text(raw.deviceId, 'Appareil d’activation', true),
  };
}

export function parseBillingOverviewResponse(value: unknown): BillingOverviewResponse {
  const raw = record(value, 'Vue de facturation');
  if (!Array.isArray(raw.offers)) throw new CommercialContractError('Catalogue d’offres invalide.');
  const offers = raw.offers.map((entry): BillingOfferView => {
    const offer = record(entry, 'Offre');
    if (!['author_ai', 'studio'].includes(String(offer.offerCode)) ||
      !['month', 'year'].includes(String(offer.billingInterval)) ||
      typeof offer.unitAmountMinor !== 'number' || !Number.isSafeInteger(offer.unitAmountMinor) || offer.unitAmountMinor < 0 ||
      typeof offer.testMode !== 'boolean')
      throw new CommercialContractError('Offre invalide.');
    return {
      selectionId: text(offer.selectionId, 'Identifiant de l’offre')!,
      offerCode: offer.offerCode as BillingOfferView['offerCode'],
      displayName: text(offer.displayName, 'Nom de l’offre')!,
      description: text(offer.description, 'Description de l’offre', true),
      billingInterval: offer.billingInterval as BillingInterval,
      currency: text(offer.currency, 'Devise')!,
      unitAmountMinor: offer.unitAmountMinor,
      testMode: offer.testMode,
    };
  });
  return { offers, billing: parseBillingState(raw.billing), request_id: text(raw.request_id, 'Référence de facturation')! };
}

export function parseActivationStatusResponse(value: unknown): ActivationStatusResponse {
  const raw = record(value, 'État des activations');
  if (!Array.isArray(raw.activations)) throw new CommercialContractError('Liste des activations invalide.');
  return {
    activations: raw.activations.map(parseActivation),
    request_id: text(raw.request_id, 'Référence des activations')!,
  };
}
