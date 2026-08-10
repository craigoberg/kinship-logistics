import {
  ATTENDANCE_DAY_OPTIONS,
  ONBOARDING_PACK_LABELS,
  transportLabel,
  type OnboardingFormPayload,
} from "@/lib/onboarding/form-types";
import {
  ACCOMPANYING_DECLARATION_BLOCKS,
  CLIENT_CONSENT_BLOCKS,
  SERVICE_SUMMARY,
  STAFF_DECLARATION_BLOCKS,
  VOLUNTEER_EXTRA_BLOCKS,
} from "@/lib/onboarding/consent-copy";

interface Props {
  payload: OnboardingFormPayload;
  /** When true, omit filled answers (blank paper path). */
  blank?: boolean;
  filingLocation?: string | null;
  signeeName?: string | null;
  signeeRelationship?: string | null;
  signedAt?: string | null;
}

function Line({ label, value }: { label: string; value?: string }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-2 border-b border-black/20 py-1 text-sm">
      <span className="font-medium">{label}</span>
      <span>{value?.trim() ? value : "____________________________"}</span>
    </div>
  );
}

function SigBlock({ title }: { title: string }) {
  return (
    <div className="mt-4 break-inside-avoid rounded border border-black/40 p-3 text-sm">
      <p className="font-semibold">{title}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <p>Signature: _______________________________</p>
        <p>Date: _______________</p>
        <p>Name: ___________________________________</p>
        <p>Relationship: ___________________________</p>
      </div>
    </div>
  );
}

export function OnboardingPrintView({
  payload,
  blank = false,
  filingLocation,
  signeeName,
  signeeRelationship,
  signedAt,
}: Props) {
  const v = (s: string) => (blank ? "" : s);

  return (
    <div
      data-onboarding-print
      className="mx-auto max-w-3xl space-y-4 bg-white p-6 text-black print:p-0"
    >
      <header className="border-b-2 border-black pb-3">
        <h1 className="text-xl font-bold">
          YADA — {ONBOARDING_PACK_LABELS[payload.pack]}
        </h1>
        <p className="mt-1 text-xs">{SERVICE_SUMMARY}</p>
        {blank ? (
          <p className="mt-2 text-sm font-semibold">BLANK FORM — fill by hand</p>
        ) : null}
      </header>

      {payload.pack === "client" ? (
        <>
          <section>
            <h2 className="mb-2 text-base font-bold">Client information</h2>
            <Line label="Funding" value={v(payload.fundingType)} />
            <Line label="NDIS number" value={v(payload.ndisNumber)} />
            <Line label="First name" value={v(payload.firstName)} />
            <Line label="Surname" value={v(payload.lastName)} />
            <Line label="Preferred name" value={v(payload.preferredName)} />
            <Line label="Date of birth" value={v(payload.dateOfBirth)} />
            <Line label="Gender" value={v(payload.gender)} />
            <Line label="Phone" value={v(payload.phone)} />
            <Line label="Email" value={v(payload.email)} />
            <Line
              label="Address"
              value={v(
                [payload.streetAddress, payload.suburb, payload.postcode]
                  .filter(Boolean)
                  .join(", "),
              )}
            />
            <Line label="Pickup address" value={v(payload.regularPickupAddress)} />
            <Line label="Disability" value={v(payload.disability)} />
            <Line label="Medications" value={v(payload.medicationsText)} />
            <Line label="Allergies" value={v(payload.allergiesText)} />
            <Line
              label="IDDSI"
              value={v(
                `Liquids ${payload.iddsiLiquids} / Solids ${payload.iddsiSolids}`,
              )}
            />
            <Line
              label="Emergency"
              value={v(
                `${payload.emergencyName} · ${payload.emergencyPhone} · ${payload.emergencyRelationship}`,
              )}
            />
            <Line label="GP" value={v(`${payload.gpName} · ${payload.gpPhone}`)} />
          </section>
          <section>
            <h2 className="mb-2 text-base font-bold">Attendance & transport</h2>
            {(blank
              ? ATTENDANCE_DAY_OPTIONS.map((d) => ({
                  dayCode: d.code,
                  enabled: true,
                  inbound: "bus" as const,
                  outbound: "bus" as const,
                  expectedArrival: "",
                  expectedDeparture: "",
                }))
              : payload.attendance.filter((d) => d.enabled)
            ).map((d) => {
              const label =
                ATTENDANCE_DAY_OPTIONS.find((x) => x.code === d.dayCode)?.label ??
                d.dayCode;
              return (
                <Line
                  key={d.dayCode}
                  label={label}
                  value={
                    blank
                      ? "☐ Attend · In ______ Out ______ · Times ______"
                      : `In ${transportLabel(d.inbound)} · Out ${transportLabel(d.outbound)} · ${d.expectedArrival}–${d.expectedDeparture}`
                  }
                />
              );
            })}
          </section>
          <section>
            <h2 className="mb-2 text-base font-bold">Consents & terms</h2>
            {CLIENT_CONSENT_BLOCKS.map((b) => (
              <div key={b.key} className="mb-3 break-inside-avoid text-sm">
                <p className="font-semibold">{b.title}</p>
                <p className="mt-1">{b.body}</p>
                <p className="mt-1">
                  {blank
                    ? "☐ I agree"
                    : (payload.consents as Record<string, boolean>)[b.key]
                      ? "☑ Agreed"
                      : "☐ Declined / not agreed"}
                </p>
              </div>
            ))}
            <SigBlock title="Client / guardian sign-off" />
          </section>
        </>
      ) : null}

      {payload.pack === "staff" || payload.pack === "volunteer" ? (
        <>
          <section>
            <h2 className="mb-2 text-base font-bold">Person</h2>
            <Line label="Full name" value={v(payload.fullName)} />
            <Line label="DOB" value={v(payload.dateOfBirth)} />
            <Line label="Phone" value={v(payload.phone)} />
            <Line label="Email" value={v(payload.email)} />
            <Line label="Address" value={v(payload.streetAddress)} />
            {payload.pack === "staff" ? (
              <>
                <Line label="Job title" value={v(payload.jobTitle)} />
                <Line label="System access" value={v(payload.systemAccess)} />
              </>
            ) : (
              <>
                <Line label="Role" value={v(payload.roleDescription)} />
                <Line label="Available" value={v(payload.daysAvailable)} />
                <Line label="Supervisor" value={v(payload.supervisorName)} />
              </>
            )}
            <Line label="WWCC" value={v(`${payload.wwccNumber} exp ${payload.wwccExpiry}`)} />
            <Line
              label="NDIS screening"
              value={v(
                `${payload.ndisScreeningNumber} exp ${payload.ndisScreeningExpiry}`,
              )}
            />
          </section>
          <section>
            <h2 className="mb-2 text-base font-bold">Declarations</h2>
            {STAFF_DECLARATION_BLOCKS.map((b) => (
              <div key={b.key} className="mb-2 text-sm">
                <p className="font-semibold">{b.title}</p>
                <p>{b.body}</p>
              </div>
            ))}
            {payload.pack === "volunteer"
              ? VOLUNTEER_EXTRA_BLOCKS.map((b) => (
                  <div key={b.key} className="mb-2 text-sm">
                    <p className="font-semibold">{b.title}</p>
                    <p>{b.body}</p>
                  </div>
                ))
              : null}
            <SigBlock title="Worker / volunteer sign-off" />
            <SigBlock title="Manager induction sign-off" />
          </section>
        </>
      ) : null}

      {payload.pack === "accompanying" ? (
        <>
          <section>
            <h2 className="mb-2 text-base font-bold">Accompanying support person</h2>
            <Line label="Full name" value={v(payload.fullName)} />
            <Line label="Relationship" value={v(payload.relationship)} />
            <Line label="Phone" value={v(payload.phone)} />
            <Line label="Linked client" value={v(payload.linkedParticipantName)} />
            <Line label="WWCC" value={v(`${payload.wwccNumber} exp ${payload.wwccExpiry}`)} />
            <Line label="Days / notes" value={v(payload.daysNotes)} />
          </section>
          <section>
            {ACCOMPANYING_DECLARATION_BLOCKS.map((b) => (
              <div key={b.key} className="mb-2 text-sm">
                <p className="font-semibold">{b.title}</p>
                <p>{b.body}</p>
              </div>
            ))}
            <SigBlock title="Accompanying person sign-off" />
          </section>
        </>
      ) : null}

      <section className="break-inside-avoid border border-dashed border-black/50 p-3 text-sm">
        <p className="font-semibold">Office use — ALPHA evidence</p>
        <Line label="Filing location" value={filingLocation ?? ""} />
        <Line label="Signed date" value={signedAt?.slice(0, 10) ?? ""} />
        <Line label="Signee" value={signeeName ?? ""} />
        <Line label="Relationship" value={signeeRelationship ?? ""} />
      </section>
    </div>
  );
}
