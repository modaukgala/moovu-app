import MoovuLoadingScreen from "./MoovuLoadingScreen";

type LoadingStateProps = { title: string; description?: string };

export default function LoadingState({ title, description }: LoadingStateProps) {
  return <MoovuLoadingScreen message={description || title} layout="contained" />;
}
