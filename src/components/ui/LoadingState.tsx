type LoadingStateProps = {
  title: string;
  description?: string;
};

export default function LoadingState({ title, description }: LoadingStateProps) {
  return (
    <main className="moovu-app-screen">
      <div className="moovu-app-container">
        <div className="moovu-loading-card">
          <div>
            <div className="moovu-kicker">MOOVU Kasi Rides</div>
            <h1 className="mt-2 text-2xl font-black text-slate-950">{title}</h1>
            {description ? <p className="mt-2 text-sm text-slate-600">{description}</p> : null}
          </div>
          <div className="grid gap-3">
            <div className="moovu-skeleton h-5 w-44" />
            <div className="moovu-skeleton h-16 w-full" />
            <div className="moovu-skeleton h-24 w-full" />
          </div>
        </div>
      </div>
    </main>
  );
}

