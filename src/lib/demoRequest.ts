/**
 * Facility demo request (senior-living page → POST /api/demo), chat 13.
 * One validator shared by the form and the route so both accept exactly the
 * same input and show the same messages.
 */
import { EMAIL_RE } from './validation';
import { toUsE164 } from './phone';

export const DEMO_ROLES = [
  { value: 'executive_director', label: 'Executive director' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'life_enrichment', label: 'Life enrichment / activities' },
  { value: 'nursing', label: 'Nursing or care staff' },
  { value: 'sales_marketing', label: 'Sales or marketing' },
  { value: 'owner_operator', label: 'Owner or operator' },
  { value: 'other', label: 'Other' },
] as const;

export type DemoRole = (typeof DEMO_ROLES)[number]['value'];

export function demoRoleLabel(role: string): string {
  return DEMO_ROLES.find((r) => r.value === role)?.label ?? 'Other';
}

export const DEMO_MAX_RESIDENTS = 5000;

export interface DemoRequestInput {
  facility_name?: unknown;
  residents?: unknown;
  role?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
}

export interface DemoRequest {
  facilityName: string;
  residents: number;
  role: DemoRole;
  name: string;
  email: string;
  /** E.164, or null when left blank. */
  phone: string | null;
}

export type DemoField = 'facility_name' | 'residents' | 'role' | 'name' | 'email' | 'phone';

export type DemoValidation =
  | { ok: true; value: DemoRequest }
  | { ok: false; errors: Partial<Record<DemoField, string>> };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function validateDemoRequest(input: DemoRequestInput): DemoValidation {
  const errors: Partial<Record<DemoField, string>> = {};

  const facilityName = str(input.facility_name);
  if (!facilityName) errors.facility_name = 'Please enter your community’s name.';
  else if (facilityName.length > 200) errors.facility_name = 'Please keep the community name under 200 characters.';

  const residentsRaw = str(input.residents);
  const residents = /^\d+$/.test(residentsRaw) ? Number(residentsRaw) : NaN;
  if (!residentsRaw) errors.residents = 'Please enter roughly how many residents you have.';
  else if (!Number.isInteger(residents) || residents < 1 || residents > DEMO_MAX_RESIDENTS)
    errors.residents = `Please enter a whole number between 1 and ${DEMO_MAX_RESIDENTS.toLocaleString('en-US')}.`;

  const role = str(input.role);
  if (!DEMO_ROLES.some((r) => r.value === role)) errors.role = 'Please choose your role.';

  const name = str(input.name);
  if (!name) errors.name = 'Please enter your name.';
  else if (name.length > 120) errors.name = 'Please keep your name under 120 characters.';

  const email = str(input.email).toLowerCase();
  if (!email || email.length > 320 || !EMAIL_RE.test(email)) errors.email = 'Please enter a valid work email, like name@community.com.';

  const phoneRaw = str(input.phone);
  let phone: string | null = null;
  if (phoneRaw) {
    phone = toUsE164(phoneRaw);
    if (!phone) errors.phone = 'Please enter a 10-digit US phone number, or leave it blank.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { facilityName, residents, role: role as DemoRole, name, email, phone } };
}
