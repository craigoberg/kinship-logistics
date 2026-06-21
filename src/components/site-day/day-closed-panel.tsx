import { CheckCircle2, ShieldOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ClientTime } from "@/components/ui/client-time";
import type { SiteDaySession } from "@/lib/api/site-day-sessions";
import { cn } from "@/lib/utils";

interface Props {
  session: SiteDaySession;
}

export function DayClosedPanel({ session }: Props) {
  const noGo = session.phase === "closed_no_go";
  return (
    <Card
      className={cn(
        "flex items-start gap-3 border-2 p-4",
        noGo
          ? "border-red-600/60 bg-red-600/5"
          : "border-green-600/40 bg-green-600/5",
      )}
    >
      {noGo ? (
        <ShieldOff className="mt-0.5 h-6 w-6 text-red-600" />
      ) : (
        <CheckCircle2 className="mt-0.5 h-6 w-6 text-green-600" />
      )}
      <div className="space-y-1">
        <div className="text-base font-semibold">
          {noGo ? "Centre Closed — NO-GO" : "Day Closed Orderly"}
        </div>
        <p className="text-sm text-muted-foreground">
          {noGo
            ? "Dual-PIN handshake ended in NO-GO. Centre is hard-locked for clients today. Notify any expected attendees."
            : "Today's attendance has been finalised and flipped to billing-ready. The MYOB Export workspace in Admin can now pick up these rows."}
        </p>
        {session.closeDeclaredAt && (
          <p className="text-xs text-muted-foreground">
            Closed <ClientTime iso={session.closeDeclaredAt} />
            {session.closeLeaderNotes ? ` · "${session.closeLeaderNotes}"` : ""}
          </p>
        )}
      </div>
    </Card>
  );
}
