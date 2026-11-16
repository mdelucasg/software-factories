import { RefundPayoutStatus } from "~/db/schema";

const PAYOUT_STATUS_META: Record<
  RefundPayoutStatus,
  { label: string; className: string }
> = {
  [RefundPayoutStatus.Pending]: {
    label: "Pending",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  },
  [RefundPayoutStatus.Issued]: {
    label: "Issued",
    className:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  },
  [RefundPayoutStatus.Failed]: {
    label: "Failed",
    className:
      "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  },
};

export function RefundPayoutBadge({
  status,
}: {
  status: RefundPayoutStatus;
}) {
  const { label, className } = PAYOUT_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}
