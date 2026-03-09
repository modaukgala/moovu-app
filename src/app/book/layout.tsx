export default function BookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  console.log("BOOK MAP KEY:", key);
  
  return (
    <>
      <script
        src={`https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places`}
        async
        defer
      />
      {children}
    </>
  );
}