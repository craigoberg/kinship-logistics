import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClipboardList } from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { BoardPackPrintPortal, BoardPackSequence } from "@/components/reporting/board-pack-print";
import {
  defaultBoardPackRange,
  loadBoardPack,
  readBoardPackLastTo,
  rememberBoardPackLastTo,
  type BoardPack,
} from "@/lib/reporting/board-pack";
import { requiredFieldOutline } from "@/lib/ui/required-field";
import { formatDate, parseIsoDateLocal, todayLocalIso, toIsoDateString } from "@/lib/utils";

export function ReportingPage() {
  const [openPack, setOpenPack] = useState(false);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reporting</h1>
        <p className="text-sm text-muted-foreground">
          Board papers drawn from the Hub. Each report is live for the dates you choose.
        </p>
      </header>

      {openPack ? (
        <BoardPackPanel onBack={() => setOpenPack(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setOpenPack(true)}
          className="flex w-full max-w-xl items-start gap-3 rounded-lg border bg-card p-4 text-left hover:bg-accent/40"
        >
          <ClipboardList className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <span className="space-y-1">
            <span className="block font-medium">Centre and trips board pack</span>
            <span className="block text-sm text-muted-foreground">
              Centre days and trips in a date range, then each trip’s Trip Report and the
              incident sheets. Print starts each of those on a new page.
            </span>
          </span>
        </button>
      )}
    </div>
  );
}

function BoardPackPanel({ onBack }: { onBack: () => void }) {
  const lastQ = useQuery({
    queryKey: ["reporting-board-pack-last-to"],
    queryFn: readBoardPackLastTo,
  });
  const [fromIso, setFromIso] = useState("");
  const [toIso, setToIso] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [printPack, setPrintPack] = useState<BoardPack | null>(null);

  useEffect(() => {
    if (seeded || !lastQ.isFetched) return;
    const range = defaultBoardPackRange(lastQ.data ?? null, todayLocalIso());
    setFromIso(range.from);
    setToIso(range.to);
    setSeeded(true);
  }, [seeded, lastQ.isFetched, lastQ.data]);

  const rangeInvalid = !fromIso || !toIso || fromIso > toIso;
  const missing: string[] = [];
  if (!fromIso) missing.push("From date");
  if (!toIso) missing.push("To date");
  if (fromIso && toIso && fromIso > toIso) missing.push("From is after To");

  const packQ = useQuery({
    queryKey: ["reporting-board-pack", fromIso, toIso],
    queryFn: () => loadBoardPack(fromIso, toIso),
    enabled: seeded && !rangeInvalid,
  });

  const print = () => {
    if (!packQ.data) return;
    const pack = packQ.data;
    setPrintPack(pack);
    window.setTimeout(() => {
      window.print();
      void rememberBoardPackLastTo(pack.toIso)
        .then(() => {
          void lastQ.refetch();
        })
        .catch(() => {
          toast.error(
            "Printed. The next opening date will stay as it is until the board-pack date SQL is loaded.",
          );
        });
    }, 400);
  };

  useEffect(() => {
    const clear = () => setPrintPack(null);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          All reports
        </Button>
        <Button type="button" onClick={print} disabled={!packQ.data || rangeInvalid}>
          Print
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">From</Label>
          <DatePicker
            value={parseIsoDateLocal(fromIso)}
            onChange={(d) => setFromIso(d ? toIsoDateString(d) : "")}
            dateFormat="dd-MMM-yy"
            className={requiredFieldOutline(!fromIso || (!!toIso && fromIso > toIso), "h-9 text-sm")}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">To</Label>
          <DatePicker
            value={parseIsoDateLocal(toIso)}
            onChange={(d) => setToIso(d ? toIsoDateString(d) : "")}
            dateFormat="dd-MMM-yy"
            className={requiredFieldOutline(!toIso || (!!fromIso && fromIso > toIso), "h-9 text-sm")}
          />
        </div>
      </div>

      {missing.length > 0 ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {missing.join(" · ")}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {formatDate(fromIso)} to {formatDate(toIso)}. Print starts the Day Centre summary, each
          centre incident, the trips summary, then each Trip Report and that trip’s incidents
          on a new page. It remembers the To date for the next time this report is opened.
        </p>
      )}

      {packQ.isLoading ? <p className="text-sm">Loading the pack…</p> : null}
      {packQ.error ? (
        <p className="text-sm text-destructive">{(packQ.error as Error).message}</p>
      ) : null}

      {packQ.data ? <BoardPackSequence pack={packQ.data} /> : null}

      {printPack ? <BoardPackPrintPortal pack={printPack} /> : null}
    </div>
  );
}
