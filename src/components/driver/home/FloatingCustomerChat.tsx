import TripChatPanel from "@/components/trip-chat/TripChatPanel";

export default function FloatingCustomerChat({ tripId, initialOpen }: { tripId: string | null; initialOpen: boolean }) {
  if (!tripId) return null;
  return <div className="driver-floating-chat"><TripChatPanel tripId={tripId} label="Chat with customer" buttonClassName="moovu-floating-chat-button" initialOpen={initialOpen} /></div>;
}
