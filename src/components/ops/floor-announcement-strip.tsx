/**
 * Global sticky strip in AppShell — Emergency (actions) or calm MOTD.
 * Emergency wins over MOTD while active.
 */
import { Megaphone } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { EmergencyOpsBanner } from "@/components/ops/emergency-ops-banner";
import { useFloorAnnouncement } from "@/hooks/use-floor-announcement";

export function FloorAnnouncementStrip() {
  const { announcement } = useFloorAnnouncement();
  const navigate = useNavigate();

  if (!announcement) return null;

  if (announcement.kind === "emergency") {
    return (
      <EmergencyOpsBanner
        variant="hub"
        className="sticky top-0 z-[55]"
        onOpenHubIssue={(hubIssueId) => {
          void navigate({
            to: "/governance",
            search: { issue: hubIssueId },
          });
        }}
      />
    );
  }

  return (
    <div className="flex items-start gap-2.5 border-b-2 border-sky-800 bg-sky-500 px-4 py-2.5 text-sky-950 shadow-sm md:px-6">
      <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-sky-950" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-black uppercase tracking-wider text-sky-950/80">
          Message of the day
        </p>
        <p className="text-sm font-bold whitespace-pre-wrap text-sky-950 sm:text-base">
          {announcement.message}
        </p>
      </div>
    </div>
  );
}
