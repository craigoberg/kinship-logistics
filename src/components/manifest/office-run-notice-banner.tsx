import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  useAcknowledgeTripRunNotice,
  useOpenTripRunNotices,
} from "@/hooks/use-supabase-data";
import {
  CAUTION_CALLOUT_BODY_CLASS,
  CAUTION_CALLOUT_CLASS,
  CAUTION_CALLOUT_ICON_CLASS,
} from "@/lib/ui/caution-callout";

export function OfficeRunNoticeBanner({
  tripId,
  className,
}: {
  tripId: string;
  className?: string;
}) {
  const { data: notices = [] } = useOpenTripRunNotices(tripId);
  const ack = useAcknowledgeTripRunNotice();
  if (notices.length === 0) return null;

  return (
    <div className={`${CAUTION_CALLOUT_CLASS} space-y-2 ${className ?? ""}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className={CAUTION_CALLOUT_ICON_CLASS} />
        <div className={CAUTION_CALLOUT_BODY_CLASS}>
          <p className="font-bold">Office update</p>
          {notices.map((n) => (
            <div key={n.id} className="mt-1 flex items-start justify-between gap-2">
              <p>{n.message}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0"
                disabled={ack.isPending}
                onClick={() => ack.mutate(n.id)}
              >
                Seen
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
