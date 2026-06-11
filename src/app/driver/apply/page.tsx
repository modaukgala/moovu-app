"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";

const steps = [
  "Eligibility",
  "Account",
  "Personal",
  "Documents",
  "Vehicle",
  "Photos",
  "Review",
] as const;

const requiredDocuments = [
  "SA ID or passport",
  "Driver licence",
  "Proof of residence",
  "Profile photo",
];

const optionalDocuments = [
  "PDP / PrDP",
  "Police clearance",
  "Transport permit",
];

const vehicleDocuments = [
  "Vehicle registration",
  "Licence disc",
  "Roadworthy certificate",
  "Insurance proof if available",
];

const vehiclePhotos = ["Front", "Back", "Left side", "Right side", "Interior", "Number plate"];

type PdpStatus = "uploaded" | "not_available_yet" | "applying";

type ApplyForm = {
  age18: string;
  validLicence: string;
  pdpStatus: PdpStatus;
  vehicleAccess: string;
  ownershipType: string;
  operatingArea: string;
  training: string;
  fullName: string;
  phone: string;
  email: string;
  password: string;
  password2: string;
  idNumber: string;
  dateOfBirth: string;
  address: string;
  emergencyName: string;
  emergencyPhone: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleYear: string;
  vehicleColor: string;
  plate: string;
  vin: string;
  engineNumber: string;
  seatingCapacity: string;
  vehicleCategory: string;
  notes: string;
};

const initialForm: ApplyForm = {
  age18: "yes",
  validLicence: "yes",
  pdpStatus: "not_available_yet",
  vehicleAccess: "yes",
  ownershipType: "owned",
  operatingArea: "",
  training: "yes",
  fullName: "",
  phone: "",
  email: "",
  password: "",
  password2: "",
  idNumber: "",
  dateOfBirth: "",
  address: "",
  emergencyName: "",
  emergencyPhone: "",
  vehicleMake: "",
  vehicleModel: "",
  vehicleYear: "",
  vehicleColor: "",
  plate: "",
  vin: "",
  engineNumber: "",
  seatingCapacity: "",
  vehicleCategory: "MOOVU Go",
  notes: "",
};

function pdpLabel(status: PdpStatus) {
  if (status === "uploaded") return "Yes, I have one";
  if (status === "applying") return "I am applying for one";
  return "No, I do not have one yet";
}

function readiness(form: ApplyForm) {
  const checks = [
    form.age18 === "yes",
    form.validLicence === "yes",
    form.vehicleAccess === "yes",
    Boolean(form.fullName && form.phone && form.email),
    Boolean(form.idNumber && form.dateOfBirth && form.address),
    Boolean(form.vehicleMake && form.vehicleModel && form.plate),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export default function DriverApplyPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ApplyForm>(initialForm);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const score = useMemo(() => readiness(form), [form]);
  const blockers = useMemo(() => {
    const items: string[] = [];
    if (form.validLicence === "no") items.push("A valid driver licence is required.");
    if (form.vehicleAccess === "no") items.push("Access to a 4-door roadworthy vehicle is required.");
    return items;
  }, [form.validLicence, form.vehicleAccess]);

  function update<K extends keyof ApplyForm>(key: K, value: ApplyForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function next() {
    if (step < steps.length - 1) setStep((current) => current + 1);
  }

  function back() {
    if (step > 0) setStep((current) => current - 1);
  }

  function validateBeforeSubmit() {
    if (blockers.length) return blockers[0];
    if (!form.fullName.trim()) return "Enter your full name.";
    if (!form.phone.trim()) return "Enter your cellphone number.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid email address.";
    if (form.password.length < 6) return "Password must be at least 6 characters.";
    if (form.password !== form.password2) return "Passwords do not match.";
    if (!form.idNumber.trim()) return "Enter your ID or passport number.";
    if (!form.vehicleMake.trim() || !form.vehicleModel.trim() || !form.plate.trim()) {
      return "Enter your basic vehicle details.";
    }
    return null;
  }

  async function submitApplication() {
    const validation = validateBeforeSubmit();
    if (validation) {
      setMsg(validation);
      return;
    }

    setBusy(true);
    setMsg(null);

    try {
      const signup = await supabaseClient.auth.signUp({
        email: form.email.trim(),
        password: form.password,
        options: {
          data: {
            role: "driver",
            full_name: form.fullName.trim(),
            phone: form.phone.trim(),
          },
        },
      });

      if (signup.error) {
        setMsg(signup.error.message);
        return;
      }

      const userId = signup.data.user?.id;
      if (!userId) {
        setMsg("Account created, but email confirmation may be required before we can submit the application.");
        return;
      }

      const applicationData = {
        eligibility: {
          age18: form.age18,
          validLicence: form.validLicence,
          pdpStatus: form.pdpStatus,
          vehicleAccess: form.vehicleAccess,
          ownershipType: form.ownershipType,
          operatingArea: form.operatingArea,
          training: form.training,
        },
        personal: {
          idNumber: form.idNumber,
          dateOfBirth: form.dateOfBirth,
          address: form.address,
          emergencyName: form.emergencyName,
          emergencyPhone: form.emergencyPhone,
        },
        vehicle: {
          make: form.vehicleMake,
          model: form.vehicleModel,
          year: form.vehicleYear,
          color: form.vehicleColor,
          plate: form.plate,
          vin: form.vin,
          engineNumber: form.engineNumber,
          seatingCapacity: form.seatingCapacity,
          category: form.vehicleCategory,
          ownershipType: form.ownershipType,
        },
        documents: {
          required: requiredDocuments,
          optional: optionalDocuments,
          vehicle: vehicleDocuments,
          photos: vehiclePhotos,
          pdpStatus: form.pdpStatus,
        },
        readinessScore: score,
      };

      const res = await fetch("/api/driver/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          fullName: form.fullName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          notes: form.notes.trim(),
          applicationData,
          pdpStatus: form.pdpStatus,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Could not submit your driver application.");
        return;
      }

      setMsg("Application submitted. Sign in later to continue uploads and track your status.");
      setTimeout(() => router.push("/driver/login"), 1200);
    } catch {
      setMsg("Could not submit your driver application. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="moovu-page min-h-screen pb-28 text-slate-950">
      <div className="moovu-shell max-w-6xl space-y-6 py-6 sm:py-10">
        <section className="moovu-card overflow-hidden p-0">
          <div className="grid gap-6 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 sm:p-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <div className="moovu-section-title">Drive with MOOVU</div>
              <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">
                Start your MOOVU Driver application
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                Apply for local trips, upload your documents, add your vehicle, and continue later from the driver portal if anything is incomplete.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm">OTP-secured trips</span>
                <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm">Clear earnings</span>
                <span className="rounded-full bg-white px-4 py-2 text-sm font-black text-slate-700 shadow-sm">Local demand</span>
              </div>
            </div>

            <div className="rounded-[2rem] bg-white/85 p-5 shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Application readiness</div>
                  <div className="mt-1 text-4xl font-black text-slate-950">{score}%</div>
                </div>
                <div className="grid h-16 w-16 place-items-center rounded-3xl bg-[var(--moovu-primary)] text-2xl font-black text-white">
                  {step + 1}
                </div>
              </div>
              <div className="mt-5 h-3 rounded-full bg-slate-100">
                <div
                  className="h-3 rounded-full bg-gradient-to-r from-[var(--moovu-primary)] to-emerald-400"
                  style={{ width: `${score}%` }}
                />
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">
                PDP / PrDP is tracked, but it does not block your application. MOOVU may request it later.
              </p>
            </div>
          </div>
        </section>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        <section className="moovu-card p-4 sm:p-5">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {steps.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(index)}
                className={`min-w-fit rounded-2xl px-4 py-3 text-sm font-black transition ${
                  step === index
                    ? "bg-[var(--moovu-primary)] text-white shadow-lg shadow-blue-200"
                    : index < step
                      ? "bg-emerald-50 text-emerald-800"
                      : "bg-slate-100 text-slate-600"
                }`}
              >
                {index + 1}. {label}
              </button>
            ))}
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-7">
          {step === 0 && (
            <div className="space-y-5">
              <StepTitle title="Eligibility Check" text="These questions help MOOVU understand whether you are ready now or need follow-up before operating." />
              <OptionGroup label="Are you 18 years or older?" value={form.age18} onChange={(v) => update("age18", v)} options={[["yes", "Yes"], ["no", "No"]]} />
              <OptionGroup label="Do you have a valid driver licence?" value={form.validLicence} onChange={(v) => update("validLicence", v)} options={[["yes", "Yes"], ["no", "No"]]} />
              <OptionGroup
                label="Do you have a PDP / PrDP?"
                value={form.pdpStatus}
                onChange={(v) => update("pdpStatus", v as PdpStatus)}
                options={[
                  ["uploaded", "Yes, I have one"],
                  ["not_available_yet", "No, not yet"],
                  ["applying", "I am applying for one"],
                ]}
              />
              <OptionGroup label="Do you have access to a 4-door roadworthy vehicle?" value={form.vehicleAccess} onChange={(v) => update("vehicleAccess", v)} options={[["yes", "Yes"], ["no", "No"]]} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Which area will you operate in?" value={form.operatingArea} onChange={(v) => update("operatingArea", v)} placeholder="Siyabuswa, KwaMhlanga..." />
                <SelectField label="Vehicle ownership" value={form.ownershipType} onChange={(v) => update("ownershipType", v)} options={["owned", "rented", "fleet-owned", "borrowed"]} />
              </div>
              <OptionGroup label="Are you willing to complete MOOVU onboarding/training?" value={form.training} onChange={(v) => update("training", v)} options={[["yes", "Yes"], ["no", "No"]]} />
              {blockers.length > 0 && <Warning>{blockers.join(" ")}</Warning>}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <StepTitle title="Account Details" text="Create your secure driver account. If you already applied, sign in and continue from the driver portal." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" value={form.fullName} onChange={(v) => update("fullName", v)} placeholder="Gift Driver" />
                <Field label="Cellphone number" value={form.phone} onChange={(v) => update("phone", v)} placeholder="07..." />
                <Field label="Email address" value={form.email} onChange={(v) => update("email", v)} placeholder="driver@example.com" type="email" />
                <div className="flex items-end">
                  <Link href="/driver/login" className="moovu-btn moovu-btn-secondary w-full justify-center">
                    Already have an account? Sign in
                  </Link>
                </div>
                <Field label="Password" value={form.password} onChange={(v) => update("password", v)} placeholder="Minimum 6 characters" type="password" />
                <Field label="Confirm password" value={form.password2} onChange={(v) => update("password2", v)} placeholder="Repeat password" type="password" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <StepTitle title="Personal Details" text="These details help MOOVU verify who is applying and who to contact in an emergency." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ID / passport number" value={form.idNumber} onChange={(v) => update("idNumber", v)} />
                <Field label="Date of birth" value={form.dateOfBirth} onChange={(v) => update("dateOfBirth", v)} type="date" />
                <Field label="Residential address" value={form.address} onChange={(v) => update("address", v)} className="sm:col-span-2" />
                <Field label="Emergency contact name" value={form.emergencyName} onChange={(v) => update("emergencyName", v)} />
                <Field label="Emergency contact number" value={form.emergencyPhone} onChange={(v) => update("emergencyPhone", v)} />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <StepTitle title="Driver Documents" text="Upload support is prepared for secure Supabase Storage. You can submit now and upload missing files later from the driver portal once storage policies are applied." />
              <DocumentGrid title="Required documents" items={requiredDocuments} />
              <DocumentGrid title="Optional but tracked" items={optionalDocuments} pdpStatus={pdpLabel(form.pdpStatus)} />
              {form.pdpStatus !== "uploaded" && (
                <Warning>Your PDP / PrDP has not been uploaded yet. You can still submit your application, but MOOVU may request it later.</Warning>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <StepTitle title="Vehicle Details" text="Add the vehicle you plan to use for MOOVU trips." />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vehicle make" value={form.vehicleMake} onChange={(v) => update("vehicleMake", v)} placeholder="Toyota" />
                <Field label="Vehicle model" value={form.vehicleModel} onChange={(v) => update("vehicleModel", v)} placeholder="Corolla" />
                <Field label="Vehicle year" value={form.vehicleYear} onChange={(v) => update("vehicleYear", v)} placeholder="2020" />
                <Field label="Vehicle colour" value={form.vehicleColor} onChange={(v) => update("vehicleColor", v)} placeholder="White" />
                <Field label="Number plate" value={form.plate} onChange={(v) => update("plate", v)} />
                <Field label="VIN" value={form.vin} onChange={(v) => update("vin", v)} />
                <Field label="Engine number" value={form.engineNumber} onChange={(v) => update("engineNumber", v)} />
                <Field label="Seating capacity" value={form.seatingCapacity} onChange={(v) => update("seatingCapacity", v)} type="number" />
                <SelectField label="Vehicle category" value={form.vehicleCategory} onChange={(v) => update("vehicleCategory", v)} options={["MOOVU Go", "MOOVU Go XL", "Both if eligible"]} />
              </div>
              <DocumentGrid title="Vehicle documents" items={vehicleDocuments} />
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <StepTitle title="Vehicle Photos" text="MOOVU reviews clear vehicle photos before allowing a driver to operate." />
              <DocumentGrid title="Required vehicle photos" items={vehiclePhotos} />
              <Warning>Photo upload cards are shown here for the application checklist. Secure private uploads require the SQL/storage setup included in this change.</Warning>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-5">
              <StepTitle title="Review & Submit" text="Check your application before submitting it for MOOVU review." />
              <div className="grid gap-4 md:grid-cols-2">
                <SummaryCard title="Eligibility" rows={[["Licence", form.validLicence], ["PDP / PrDP", pdpLabel(form.pdpStatus)], ["Vehicle access", form.vehicleAccess], ["Area", form.operatingArea || "--"]]} />
                <SummaryCard title="Account" rows={[["Name", form.fullName || "--"], ["Phone", form.phone || "--"], ["Email", form.email || "--"]]} />
                <SummaryCard title="Personal" rows={[["ID/passport", form.idNumber || "--"], ["Date of birth", form.dateOfBirth || "--"], ["Emergency", form.emergencyName || "--"]]} />
                <SummaryCard title="Vehicle" rows={[["Vehicle", `${form.vehicleMake} ${form.vehicleModel}`.trim() || "--"], ["Plate", form.plate || "--"], ["Category", form.vehicleCategory]]} />
              </div>
              <textarea
                className="moovu-input min-h-28"
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
                placeholder="Optional note for MOOVU admin"
              />
              {form.pdpStatus !== "uploaded" && (
                <Warning>This driver has not uploaded a PDP / PrDP yet. MOOVU can still review and approve under current business rules.</Warning>
              )}
            </div>
          )}

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className="moovu-btn moovu-btn-secondary justify-center" onClick={back} disabled={step === 0 || busy}>
              Back
            </button>
            {step < steps.length - 1 ? (
              <button type="button" className="moovu-btn moovu-btn-primary justify-center" onClick={next}>
                Continue
              </button>
            ) : (
              <button type="button" className="moovu-btn moovu-btn-primary justify-center" onClick={submitApplication} disabled={busy}>
                {busy ? "Submitting..." : "Submit application"}
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function StepTitle({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <div className="moovu-section-title">{title}</div>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{text}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-black text-slate-700">{label}</span>
      <input
        className="moovu-input mt-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="text-sm font-black text-slate-700">{label}</span>
      <select className="moovu-input mt-2" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function OptionGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: [string, string][];
}) {
  return (
    <div>
      <div className="text-sm font-black text-slate-700">{label}</div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {options.map(([optionValue, optionLabel]) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={`rounded-2xl border px-4 py-3 text-left text-sm font-black transition ${
              value === optionValue
                ? "border-[var(--moovu-primary)] bg-sky-50 text-[var(--moovu-primary)] shadow-sm"
                : "border-slate-200 bg-white text-slate-700"
            }`}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </div>
  );
}

function DocumentGrid({ title, items, pdpStatus }: { title: string; items: string[]; pdpStatus?: string }) {
  return (
    <div>
      <h3 className="text-lg font-black text-slate-950">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <div key={item} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-black text-slate-950">{item}</div>
                <div className="mt-1 text-xs font-bold text-slate-500">
                  {item === "PDP / PrDP" && pdpStatus ? pdpStatus : "Upload/checklist item"}
                </div>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">Pending</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SummaryCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="font-black text-slate-950">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 text-sm">
            <span className="font-bold text-slate-500">{label}</span>
            <span className="text-right font-black text-slate-900">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">
      {children}
    </div>
  );
}
