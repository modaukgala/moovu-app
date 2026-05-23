import Link from "next/link";

type DriverAuthRequiredProps = {
  title?: string;
  description?: string;
};

export default function DriverAuthRequired({
  title = "Driver login required",
  description = "Sign in to continue to your MOOVU driver workspace.",
}: DriverAuthRequiredProps) {
  return (
    <main className="moovu-auth-shell text-slate-950">
      <section className="moovu-auth-card text-center">
        <div className="moovu-chip mx-auto w-fit">
          <span className="moovu-chip-dot" />
          MOOVU Driver
        </div>
        <h1 className="mt-4 text-2xl font-black">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/driver/login" className="moovu-btn moovu-btn-primary">
            Driver login
          </Link>
          <Link href="/driver/apply" className="moovu-btn moovu-btn-secondary">
            Apply to drive
          </Link>
        </div>
      </section>
    </main>
  );
}
