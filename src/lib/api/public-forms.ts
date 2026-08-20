/**
 * BL-111 / BL-112 — public & Connect rights/voice forms → Hub (operational_incidents).
 */
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMismatchError } from "@/lib/api/supabase-errors";

const SCHEMA_HINT =
  "Public forms tables missing — run docs/sql/2026-08-10_public_cms_and_forms.sql then hard refresh.";

export type PublicFormKey =
  | "complaint"
  | "enquiry"
  | "feedback"
  | "compliment"
  | "volunteer_eoi";

export interface PublicFormDefinition {
  id: string;
  formKey: PublicFormKey | string;
  title: string;
  introHtml: string | null;
  hubTicketType: string;
  allowAnonymous: boolean;
  enabledPublic: boolean;
  enabledConnect: boolean;
  sortOrder: number;
}

export interface PublicFormSubmission {
  id: string;
  formKey: string;
  referenceCode: string;
  channel: "public" | "connect";
  isAnonymous: boolean;
  submitterName: string | null;
  submitterEmail: string | null;
  submitterPhone: string | null;
  submitterRole: string | null;
  payload: Record<string, unknown>;
  hubIncidentId: string | null;
  createdAt: string;
}

function throwSchema(err: unknown): never {
  if (
    isSchemaMismatchError(err) ||
    /public_form_|Could not find the table/i.test(
      String((err as Error)?.message ?? err),
    )
  ) {
    throw new Error(SCHEMA_HINT);
  }
  throw err;
}

function mapDef(r: Record<string, unknown>): PublicFormDefinition {
  return {
    id: String(r.id),
    formKey: String(r.form_key),
    title: String(r.title),
    introHtml: (r.intro_html as string | null) ?? null,
    hubTicketType: String(r.hub_ticket_type),
    allowAnonymous: Boolean(r.allow_anonymous),
    enabledPublic: Boolean(r.enabled_public),
    enabledConnect: Boolean(r.enabled_connect),
    sortOrder: Number(r.sort_order ?? 100),
  };
}

export async function listPublicFormDefinitions(args?: {
  channel?: "public" | "connect";
}): Promise<PublicFormDefinition[]> {
  let q = supabase
    .from("public_form_definitions")
    .select("*")
    .order("sort_order", { ascending: true });
  if (args?.channel === "public") q = q.eq("enabled_public", true);
  if (args?.channel === "connect") q = q.eq("enabled_connect", true);
  const { data, error } = await q;
  if (error) throwSchema(error);
  return (data ?? []).map((r) => mapDef(r as Record<string, unknown>));
}

export async function getPublicFormDefinition(
  formKey: string,
): Promise<PublicFormDefinition | null> {
  const { data, error } = await supabase
    .from("public_form_definitions")
    .select("*")
    .eq("form_key", formKey)
    .maybeSingle();
  if (error) throwSchema(error);
  return data ? mapDef(data as Record<string, unknown>) : null;
}

export interface SubmitPublicFormInput {
  formKey: string;
  channel: "public" | "connect";
  isAnonymous: boolean;
  submitterName?: string;
  submitterEmail?: string;
  submitterPhone?: string;
  submitterRole?: string;
  message: string;
  /** Extra structured fields */
  extra?: Record<string, unknown>;
  linkedParticipantId?: string | null;
  linkedStaffId?: string | null;
}

export async function submitPublicForm(
  input: SubmitPublicFormInput,
): Promise<{ referenceCode: string; submissionId: string; hubIncidentId: string }> {
  const def = await getPublicFormDefinition(input.formKey);
  if (!def) throw new Error("Unknown form.");
  if (input.channel === "public" && !def.enabledPublic) {
    throw new Error("This form is not available on the public site.");
  }
  if (input.channel === "connect" && !def.enabledConnect) {
    throw new Error("This form is not available in Connect.");
  }

  const message = input.message.trim();
  if (message.length < 20) {
    throw new Error("Please provide at least 20 characters in your message.");
  }

  const isAnonymous = def.allowAnonymous && input.isAnonymous;
  if (!isAnonymous && !input.submitterName?.trim()) {
    throw new Error("Name is required unless you submit anonymously.");
  }

  const { data: rpcRows, error: rpcErr } = await supabase.rpc("submit_public_form", {
    p_form_key: input.formKey,
    p_channel: input.channel,
    p_is_anonymous: isAnonymous,
    p_submitter_name: isAnonymous ? null : input.submitterName?.trim() || null,
    p_submitter_email: isAnonymous ? null : input.submitterEmail?.trim() || null,
    p_submitter_phone: isAnonymous ? null : input.submitterPhone?.trim() || null,
    p_submitter_role: input.submitterRole?.trim() || null,
    p_message: message,
    p_extra: input.extra ?? {},
    p_linked_participant_id: input.linkedParticipantId || null,
    p_linked_staff_id: input.linkedStaffId || null,
  });
  if (rpcErr) {
    const msg = rpcErr.message || "";
    if (/submit_public_form|Could not find the function/i.test(msg)) {
      throw new Error(
        "Public form RPC missing — run docs/sql/2026-08-20_day_login_operational_rls.sql then hard refresh.",
      );
    }
    throwSchema(rpcErr);
  }
  const row = (Array.isArray(rpcRows) ? rpcRows[0] : rpcRows) as {
    reference_code?: string;
    submission_id?: string;
    hub_incident_id?: string;
  } | null;
  if (!row?.reference_code || !row.submission_id || !row.hub_incident_id) {
    throw new Error("Public form submit failed — empty RPC result.");
  }

  return {
    referenceCode: String(row.reference_code),
    submissionId: String(row.submission_id),
    hubIncidentId: String(row.hub_incident_id),
  };
}

export async function listPublicFormSubmissions(limit = 100): Promise<
  PublicFormSubmission[]
> {
  const { data, error } = await supabase
    .from("public_form_submissions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throwSchema(error);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      formKey: String(row.form_key),
      referenceCode: String(row.reference_code),
      channel: row.channel as "public" | "connect",
      isAnonymous: Boolean(row.is_anonymous),
      submitterName: (row.submitter_name as string | null) ?? null,
      submitterEmail: (row.submitter_email as string | null) ?? null,
      submitterPhone: (row.submitter_phone as string | null) ?? null,
      submitterRole: (row.submitter_role as string | null) ?? null,
      payload: (row.payload as Record<string, unknown>) ?? {},
      hubIncidentId: (row.hub_incident_id as string | null) ?? null,
      createdAt: String(row.created_at),
    };
  });
}

export async function updateFormDefinitionFlags(
  formKey: string,
  patch: Partial<{
    enabledPublic: boolean;
    enabledConnect: boolean;
    introHtml: string | null;
  }>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.enabledPublic !== undefined) row.enabled_public = patch.enabledPublic;
  if (patch.enabledConnect !== undefined)
    row.enabled_connect = patch.enabledConnect;
  if (patch.introHtml !== undefined) row.intro_html = patch.introHtml;
  const { error } = await supabase
    .from("public_form_definitions")
    .update(row)
    .eq("form_key", formKey);
  if (error) throwSchema(error);
}
