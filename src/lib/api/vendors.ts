import { supabase } from "@/integrations/supabase/client";

export type VendorStatus = "active" | "archived";

export interface Vendor {
  id: string;
  name: string;
  status: VendorStatus;
  createdAt: string;
  updatedAt: string;
}

interface VendorRow {
  id: string;
  name: string;
  status: VendorStatus;
  created_at: string;
  updated_at: string;
}

function rowToVendor(r: VendorRow): Vendor {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function normalizeVendorName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function vendorNamesMatch(a: string, b: string): boolean {
  return normalizeVendorName(a).toLowerCase() === normalizeVendorName(b).toLowerCase();
}

export function findVendorByName(vendors: Vendor[], name: string): Vendor | null {
  const target = normalizeVendorName(name).toLowerCase();
  if (!target) return null;
  return (
    vendors.find(
      (v) => v.status === "active" && normalizeVendorName(v.name).toLowerCase() === target,
    ) ?? null
  );
}

export async function listVendors(status?: VendorStatus | "all"): Promise<Vendor[]> {
  let q = supabase.from("vendors").select("*").order("name", { ascending: true });
  if (status && status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => rowToVendor(r as VendorRow));
}

export async function createVendor(name: string): Promise<Vendor> {
  const trimmed = normalizeVendorName(name);
  if (trimmed.length < 2) throw new Error("Vendor name must be at least 2 characters.");

  const existing = await listVendors("active");
  const match = findVendorByName(existing, trimmed);
  if (match) return match;

  const { data, error } = await supabase
    .from("vendors")
    .insert({
      name: trimmed,
      status: "active",
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: dup, error: dupErr } = await supabase
        .from("vendors")
        .select("*")
        .ilike("name", trimmed)
        .maybeSingle();
      if (dupErr) throw dupErr;
      if (dup) return rowToVendor(dup as VendorRow);
    }
    if (error.code === "PGRST301" || (error as { status?: number }).status === 401) {
      throw new Error(
        "Permission denied saving vendor. Run docs/sql/2026-07-11_vendors_registry_rls_fix.sql in Supabase.",
      );
    }
    throw error;
  }

  return rowToVendor(data as VendorRow);
}

export async function updateVendor(
  id: string,
  patch: { name?: string; status?: VendorStatus },
): Promise<Vendor> {
  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.name !== undefined) {
    const trimmed = normalizeVendorName(patch.name);
    if (trimmed.length < 2) throw new Error("Vendor name must be at least 2 characters.");
    row.name = trimmed;
  }
  if (patch.status !== undefined) row.status = patch.status;

  const { data, error } = await supabase
    .from("vendors")
    .update(row)
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    if (error.code === "PGRST301" || (error as { status?: number }).status === 401) {
      throw new Error(
        "Permission denied updating vendor. Run docs/sql/2026-07-11_vendors_registry_rls_fix.sql in Supabase.",
      );
    }
    throw error;
  }
  return rowToVendor(data as VendorRow);
}
