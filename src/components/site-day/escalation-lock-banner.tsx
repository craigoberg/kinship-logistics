import { ShieldAlert } from "lucide-react";
import { ClientTime } from "@/components/ui/client-time";
import type { SiteDaySession } from "@/lib/api/site-day-sessions";

interface Props {
  session: SiteDaySession;
}

export function EscalationLockBanner({ session }: Props) {
  return (
    <div className="flex items-start gap-3 rounded-lg border-2 border-red-600/60 bg-red-600/10 p-4 text-red-700 dark:text-red-300">
      <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0" />
      <div className="space-y-1">
        <div className="text-base font-bold uppercase tracking-wide">
          Site Locked — Unresolved Red issue
        </div>
        <p className="text-sm">
          An unresolved Red issue is blocking the Day Centre. A Manager must
          clear it in the Governance Hub before the open-centre workflow can
          restart.
        </p>
        {session.openDeclaredAt && (
          <p className="text-xs opacity-80">
            Session opened <ClientTime iso={session.openDeclaredAt} />
          </p>
        )}
      </div>
    </div>
  );
}
