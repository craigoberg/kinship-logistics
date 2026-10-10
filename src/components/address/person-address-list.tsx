/**
 * Named pickup places on a client, staff, or carer record.
 * Same card rhythm as staff certificates. Saves each place immediately.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IconActionButton } from "@/components/ui/icon-action-button";
import { Label } from "@/components/ui/label";
import { CharacterCountedInput } from "@/components/ui/character-counted-input";
import {
  archivePersonAddress,
  createPersonAddress,
  listPersonAddresses,
  updatePersonAddress,
  type AddressOwner,
  type PersonAddress,
} from "@/lib/api/person-addresses";

export function personAddressQueryKey(owner: AddressOwner) {
  return ["person-addresses", owner.kind, owner.id] as const;
}

export function PersonAddressList({ owner }: { owner: AddressOwner }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: personAddressQueryKey(owner),
    queryFn: () => listPersonAddresses(owner),
  });
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");

  const places = query.data ?? [];
  const labelOk = label.trim().length >= 2;
  const addressOk = address.trim().length >= 6;
  const missing: string[] = [];
  if (!labelOk) missing.push("Label");
  if (!addressOk) missing.push("Address");

  const openNew = () => {
    setEditingId("new");
    setLabel("");
    setAddress("");
  };

  const openEdit = (place: PersonAddress) => {
    setEditingId(place.id);
    setLabel(place.label);
    setAddress(place.address);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (editingId === "new") {
        return createPersonAddress({ owner, label, address });
      }
      if (editingId) {
        return updatePersonAddress({ id: editingId, owner, label, address });
      }
      throw new Error("Nothing to save.");
    },
    onSuccess: async () => {
      setEditingId(null);
      await qc.invalidateQueries({ queryKey: personAddressQueryKey(owner) });
      toast.success("Pickup place saved");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => archivePersonAddress(owner, id),
    onSuccess: async () => {
      setEditingId(null);
      await qc.invalidateQueries({ queryKey: personAddressQueryKey(owner) });
      toast.success("Pickup place removed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <section className="space-y-2 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Other pickup places
        </Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5"
          onClick={openNew}
          disabled={editingId === "new"}
        >
          <Plus className="h-3.5 w-3.5" />
          Add place
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Home above is the legal address. Add Mum, respite, or another stop here.
        Run Planning and the driver pick from this list. They do not replace Home.
      </p>
      {query.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading places…</p>
      ) : places.length === 0 && editingId !== "new" ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          No other pickup places. Bus runs use Home until one is added.
        </p>
      ) : (
        <div className="space-y-2">
          {places.map((place) =>
            editingId === place.id ? (
              <Editor
                key={place.id}
                label={label}
                address={address}
                missing={missing}
                busy={save.isPending}
                onLabel={setLabel}
                onAddress={setAddress}
                onCancel={() => setEditingId(null)}
                onSave={() => save.mutate()}
                onRemove={() => remove.mutate(place.id)}
                removeBusy={remove.isPending}
              />
            ) : (
              <div
                key={place.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border bg-card/40 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{place.label}</p>
                  <p className="text-xs text-muted-foreground">{place.address}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5"
                    onClick={() => openEdit(place)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <IconActionButton
                    type="button"
                    tooltip="Remove place"
                    onClick={() => remove.mutate(place.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </IconActionButton>
                </div>
              </div>
            ),
          )}
          {editingId === "new" && (
            <Editor
              label={label}
              address={address}
              missing={missing}
              busy={save.isPending}
              onLabel={setLabel}
              onAddress={setAddress}
              onCancel={() => setEditingId(null)}
              onSave={() => save.mutate()}
            />
          )}
        </div>
      )}
    </section>
  );
}

function Editor({
  label,
  address,
  missing,
  busy,
  onLabel,
  onAddress,
  onCancel,
  onSave,
  onRemove,
  removeBusy,
}: {
  label: string;
  address: string;
  missing: string[];
  busy: boolean;
  onLabel: (v: string) => void;
  onAddress: (v: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onRemove?: () => void;
  removeBusy?: boolean;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card/40 p-3">
      <CharacterCountedInput
        label="Place name"
        value={label}
        onValueChange={onLabel}
        minChars={2}
        maxChars={40}
        required
        hint="e.g. Mum, Respite"
      />
      <CharacterCountedInput
        label="Address"
        value={address}
        onValueChange={onAddress}
        minChars={6}
        maxChars={160}
        required
      />
      {missing.length > 0 && (
        <p className="text-sm text-destructive">Missing: {missing.join(", ")}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onRemove ? (
          <Button
            type="button"
            variant="outline"
            className="text-destructive"
            disabled={removeBusy}
            onClick={onRemove}
          >
            Remove
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={missing.length > 0 || busy} onClick={onSave}>
            {busy ? "Saving…" : "Save place"}
          </Button>
        </div>
      </div>
    </div>
  );
}
