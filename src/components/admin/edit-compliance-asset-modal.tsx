import { useMemo, useState } from "react";
import { usePersistedForm } from "@/hooks/use-persisted-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CharacterCountedTextarea } from "@/components/ui/character-counted-textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PinReauthDialog } from "@/components/auth/pin-reauth-dialog";
import { getActiveUserProfile } from "@/lib/data-store";
import {
  ACTION_MODULES,
  listComplianceAssets,
  upsertComplianceAsset,
  type ComplianceActionModule,
  type ComplianceAsset,
} from "@/lib/api/compliance-assets";
import { isManagerProfile } from "@/lib/governance/is-manager";
import { parseExpiryBase, toISODate } from "@/lib/governance/next-expiry";

export function EditComplianceAssetModal({
  asset,
  onClose,
  onSaved,
}: {
  asset: ComplianceAsset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !asset;
  const draftKey = `governance-asset:${asset?.id ?? "new"}`;
  const initialValues = useMemo(
    () => ({
      category: asset?.category ?? "",
      type: asset?.type ?? "",
      name: asset?.name ?? "",
      description: asset?.description ?? "",
      expiry: asset?.expiry_date ?? "",
      actionModule: (asset?.action_module ?? "generic_resolve") as ComplianceActionModule,
      yellowDays: String(asset?.config?.yellow_days ?? 30),
      redDays: String(asset?.config?.red_days ?? 7),
      handshake: (asset?.config?.handshake === "dual" ? "dual" : "single") as
        | "single"
        | "dual",
      checklistCategory: (asset?.config?.checklist_category as string) ?? "",
      justification: "",
    }),
    [asset],
  );
  const form = usePersistedForm(draftKey, initialValues);
  const {
    category,
    type,
    name,
    description,
    expiry,
    actionModule,
    yellowDays,
    redDays,
    handshake,
    checklistCategory,
    justification,
  } = form.values;
  const setCategory = (v: string) => form.setValues({ category: v });
  const setType = (v: string) => form.setValues({ type: v });
  const setName = (v: string) => form.setValues({ name: v });
  const setDescription = (v: string) => form.setValues({ description: v });
  const setExpiry = (v: string) => form.setValues({ expiry: v });
  const setActionModule = (v: ComplianceActionModule) =>
    form.setValues({ actionModule: v });
  const setYellowDays = (v: string) => form.setValues({ yellowDays: v });
  const setRedDays = (v: string) => form.setValues({ redDays: v });
  const setHandshake = (v: "single" | "dual") => form.setValues({ handshake: v });
  const setChecklistCategory = (v: string) =>
    form.setValues({ checklistCategory: v });
  const setJustification = (v: string) => form.setValues({ justification: v });
  const [pinOpen, setPinOpen] = useState(false);

  const taxonomyQ = useQuery({
    queryKey: ["governance-hub", "taxonomy"],
    queryFn: () => listComplianceAssets({}),
    staleTime: 60_000,
  });
  const all = taxonomyQ.data ?? [];
  const categories = useMemo(
    () => Array.from(new Set(all.map((a) => a.category))).sort(),
    [all],
  );
  const typesByCategory = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const a of all) {
      (map[a.category] ??= new Set()).add(a.type);
    }
    const out: Record<string, string[]> = {};
    for (const k of Object.keys(map)) out[k] = Array.from(map[k]).sort();
    return out;
  }, [all]);

  const normCategory = category.trim().toUpperCase();
  const normType = type.trim();
  const isNewCategory = normCategory.length > 0 && !categories.includes(normCategory);
  const isNewType =
    normType.length > 0 && !(typesByCategory[normCategory] ?? []).includes(normType);
  const taxonomyChange = isNewCategory || isNewType;

  const expiryMinIso = useMemo(() => {
    const base = parseExpiryBase(asset?.expiry_date);
    const floor = new Date(Math.max(Date.now(), base.getTime()));
    return toISODate(floor);
  }, [asset?.expiry_date]);

  const mut = useMutation({
    mutationFn: async () => {
      const y = Number(yellowDays);
      const r = Number(redDays);
      if (!Number.isFinite(y) || !Number.isFinite(r)) {
        throw new Error("Yellow and Red thresholds must be numbers.");
      }
      if (r > y) throw new Error("Red threshold must be ≤ Yellow threshold.");

      const profile = getActiveUserProfile();
      const pinVerifiedBy =
        taxonomyChange && profile?.staffId ? profile.staffId : null;

      return upsertComplianceAsset(
        {
          id: asset?.id,
          category: normCategory,
          type: normType,
          name: name.trim(),
          description,
          expiry_date: expiry || null,
          action_module: actionModule,
          config: {
            yellow_days: y,
            red_days: r,
            handshake,
            checklist_category:
              actionModule === "formal_audit" ? checklistCategory || null : null,
            ...(pinVerifiedBy ? { taxonomy_pin_verified_by: pinVerifiedBy } : {}),
          },
        },
        justification,
      );
    },
    onSuccess: () => {
      toast.success(isNew ? "Compliance asset created" : "Compliance asset updated");
      form.reset();
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const descLen = description?.trim().length ?? 0;
  const justLen = justification.trim().length;
  const canSubmit =
    normCategory.length > 0 &&
    normType.length > 0 &&
    name.trim().length > 0 &&
    descLen >= 20 &&
    justLen >= 20 &&
    !mut.isPending;

  const handleSaveClick = () => {
    if (!canSubmit) return;
    setPinOpen(true);
  };

  const handlePinAuthenticated = () => {
    if (!isManagerProfile()) {
      toast.error("Manager PIN required", {
        description: "Only manager-level operators can edit registry details.",
      });
      setPinOpen(false);
      return;
    }
    setPinOpen(false);
    mut.mutate();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "New compliance asset" : "Edit registry details"}</DialogTitle>
          <DialogDescription>
            Registry taxonomy and thresholds. Day-to-day deferrals and closing happen in Manage.
          </DialogDescription>
        </DialogHeader>

        {form.hasDraft && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs">
            <span className="text-yellow-800 dark:text-yellow-200">Unsaved draft found.</span>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={form.discardDraft}>
                Discard
              </Button>
              <Button size="sm" onClick={form.resumeDraft}>
                Resume
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-1">
            <Label>Category</Label>
            <Select
              value={isNewCategory || !category ? "__NEW__" : normCategory}
              onValueChange={(v) => {
                if (v === "__NEW__") setCategory("");
                else {
                  setCategory(v);
                  if (!(typesByCategory[v] ?? []).includes(type)) setType("");
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category…" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
                <SelectItem value="__NEW__">+ Add new category…</SelectItem>
              </SelectContent>
            </Select>
            {(isNewCategory || !categories.includes(normCategory)) && (
              <Input
                className="mt-1"
                placeholder="New category (e.g. INSURANCE)"
                value={category}
                onChange={(e) => setCategory(e.target.value.toUpperCase())}
              />
            )}
          </div>
          <div className="space-y-1">
            <Label>Type</Label>
            <Select
              value={isNewType || !type ? "__NEW__" : normType}
              onValueChange={(v) => {
                if (v === "__NEW__") setType("");
                else setType(v);
              }}
              disabled={!normCategory}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={normCategory ? "Select type…" : "Pick category first"}
                />
              </SelectTrigger>
              <SelectContent>
                {(typesByCategory[normCategory] ?? []).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
                <SelectItem value="__NEW__">+ Add new type…</SelectItem>
              </SelectContent>
            </Select>
            {normCategory &&
              (isNewType || !(typesByCategory[normCategory] ?? []).includes(normType)) && (
                <Input
                  className="mt-1"
                  placeholder="New type (e.g. rego / policy)"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                />
              )}
          </div>

          {taxonomyChange && (
            <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs text-yellow-700 dark:text-yellow-300 sm:col-span-2">
              New category or type — manager PIN required on save.
            </div>
          )}

          <div className="space-y-1 sm:col-span-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <CharacterCountedTextarea
              label="Description"
              value={description ?? ""}
              onValueChange={setDescription}
              minChars={20}
              maxChars={500}
              counterMode="minimum"
              rows={2}
              placeholder="Audit-ready context (min 20 chars)"
              required
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="registry-expiry">Next expiry / renewal date</Label>
            <Input
              id="registry-expiry"
              type="date"
              value={expiry ?? ""}
              min={expiryMinIso}
              onChange={(e) => setExpiry(e.target.value)}
              className="[color-scheme:dark]"
            />
            <p className="text-[11px] text-muted-foreground">
              Edit the date directly. Preset intervals (3 / 6 / 12 months) are available in Manage.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Action module</Label>
            <Select
              value={actionModule}
              onValueChange={(v) => setActionModule(v as ComplianceActionModule)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_MODULES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Yellow threshold (days)</Label>
            <Input
              type="number"
              min={0}
              value={yellowDays}
              onChange={(e) => setYellowDays(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Red threshold (days)</Label>
            <Input
              type="number"
              min={0}
              value={redDays}
              onChange={(e) => setRedDays(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label>Handshake</Label>
            <Select value={handshake} onValueChange={(v) => setHandshake(v as "single" | "dual")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single PIN (manager)</SelectItem>
                <SelectItem value="dual">Dual PIN (manager + witness)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {actionModule === "formal_audit" && (
            <div className="space-y-1">
              <Label>Checklist category</Label>
              <Input
                placeholder="VEHICLE_FORMAL_AUDIT"
                value={checklistCategory}
                onChange={(e) => setChecklistCategory(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1 sm:col-span-2">
            <CharacterCountedTextarea
              label="Justification"
              value={justification}
              onValueChange={setJustification}
              minChars={20}
              maxChars={500}
              counterMode="minimum"
              rows={2}
              placeholder="Why is this changing? (min 20 chars, recorded in the ledger)"
              required
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSaveClick} disabled={!canSubmit}>
            {mut.isPending ? "Saving…" : "Save & log"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <PinReauthDialog
        open={pinOpen}
        onOpenChange={setPinOpen}
        reason="Manager PIN required to save registry changes."
        onAuthenticated={handlePinAuthenticated}
      />
    </Dialog>
  );
}
