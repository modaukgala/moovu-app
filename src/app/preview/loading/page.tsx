import { notFound } from "next/navigation";
import MoovuLoadingScreen, { MoovuInlineLoader } from "@/components/customer/MoovuLoadingScreen";

export default async function LoadingPreview({ searchParams }: { searchParams: Promise<{ view?: string; scene?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { view, scene } = await searchParams;
  if (scene === "mobile") return <MoovuLoadingScreen />;
  if (view === "driver") return <MoovuLoadingScreen message="Getting your Driver app ready..." />;
  if (view === "admin") return <MoovuLoadingScreen message="Checking admin access..." />;
  if (view === "mobile") return <div style={{ padding: 16, background: "#eee", minHeight: "100dvh" }}>
    <iframe title="390px Customer loading preview" src="/preview/loading?scene=mobile" style={{ display: "block", width: 390, maxWidth: "100%", height: 844, margin: "auto", border: 0, background: "white" }} />
  </div>;
  if (view === "compact") return <div style={{ padding: 32 }}><MoovuInlineLoader message="Preparing your ride..." /></div>;
  if (view === "dark") return <MoovuLoadingScreen theme="dark" />;
  return <><MoovuLoadingScreen /><div style={{ padding: 24 }}><MoovuInlineLoader message="Preparing your ride..." /></div></>;
}
