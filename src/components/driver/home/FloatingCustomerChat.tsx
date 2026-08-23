import TripChatPanel from "@/components/trip-chat/TripChatPanel";

export default function FloatingCustomerChat({
  tripId,
  initialOpen,
  tripSheetOpen,
}: {
  tripId: string | null;
  initialOpen: boolean;
  tripSheetOpen: boolean;
}) {
  if (!tripId) return null;
  return (
    <div className={`driver-floating-chat${tripSheetOpen ? " is-sheet-open" : ""}`}>
      <TripChatPanel tripId={tripId} label="Chat with customer" buttonClassName="moovu-floating-chat-button" compactButton initialOpen={initialOpen} />
    </div>
  );
}
