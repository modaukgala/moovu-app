"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import {
  getDriverDocumentLabel,
  normalizeDriverDocumentType,
  type DriverDocumentItem,
} from "@/lib/driver-documents";

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  profile_completed: boolean | null;
  verification_status: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  vehicle_registration: string | null;
  vehicle_vin: string | null;
  vehicle_engine_number: string | null;
  seating_capacity: number | null;
};

type ExistingProfile = {
  driver_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  alt_phone: string | null;
  id_number: string | null;
  home_address: string | null;
  area_name: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  license_number: string | null;
  license_code: string | null;
  license_expiry: string | null;
  pdp_number: string | null;
  pdp_expiry: string | null;
  profile_completed: boolean | null;
  submitted_at: string | null;
  updated_at: string | null;
};

type DriverDocument = {
  id: string;
  doc_type?: string | null;
  document_type?: string | null;
  status?: string | null;
  review_status?: string | null;
  rejection_reason?: string | null;
  uploaded_at?: string | null;
};

const steps = ["Eligibility", "Personal", "Documents", "Vehicle", "Photos", "Review"] as const;
const requiredDocs: DriverDocumentItem[] = [
  { label: "SA ID or passport", type: "id_document", required: true },
  { label: "Driver licence", type: "drivers_license", required: true },
  { label: "Proof of residence", type: "proof_of_residence", required: true },
  { label: "Profile photo", type: "profile_photo", required: true },
];
const optionalDocs: DriverDocumentItem[] = [
  { label: "PDP / PrDP", type: "pdp" },
  { label: "Police clearance", type: "police_clearance" },
  { label: "Transport permit", type: "transport_permit" },
];
const vehicleDocs: DriverDocumentItem[] = [
  { label: "Vehicle registration", type: "vehicle_registration", required: true },
  { label: "Licence disc", type: "vehicle_license_disc", required: true },
  { label: "Roadworthy certificate", type: "roadworthy_certificate", required: true },
  { label: "Insurance proof", type: "insurance_document" },
];
const vehiclePhotos: DriverDocumentItem[] = [
  { label: "Front", type: "vehicle_photos", required: true },
  { label: "Back", type: "vehicle_photos", required: true },
  { label: "Left side", type: "vehicle_photos", required: true },
  { label: "Right side", type: "vehicle_photos", required: true },
  { label: "Interior", type: "vehicle_photos", required: true },
  { label: "Number plate", type: "vehicle_photos", required: true },
];

export default function DriverCompleteProfilePage() {
  const router = useRouter();
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [documents, setDocuments] = useState<DriverDocument[]>([]);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [areaName, setAreaName] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseCode, setLicenseCode] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [pdpStatus, setPdpStatus] = useState<"uploaded" | "not_available_yet" | "applying">("not_available_yet");
  const [pdpNumber, setPdpNumber] = useState("");
  const [pdpExpiry, setPdpExpiry] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleRegistration, setVehicleRegistration] = useState("");
  const [vehicleVin, setVehicleVin] = useState("");
  const [vehicleEngine, setVehicleEngine] = useState("");
  const [seatingCapacity, setSeatingCapacity] = useState("");
  const [ownershipType, setOwnershipType] = useState("owned");
  const [vehicleCategory, setVehicleCategory] = useState("MOOVU Go");
  const [hasLicence, setHasLicence] = useState("yes");
  const [hasVehicle, setHasVehicle] = useState("yes");
  const [trainingReady, setTrainingReady] = useState("yes");

  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();
    return session?.access_token ?? null;
  }, []);

  const loadProfile = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/driver/login?next=/driver/complete-profile");
        return;
      }

      const res = await fetch("/api/driver/profile", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Could not load your driver application.");
        return;
      }

      const nextDriver = json.driver as Driver | null;
      const profile = json.profile as ExistingProfile | null;
      setDriver(nextDriver);
      const docsRes = await fetch("/api/driver/documents", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const docsJson = await docsRes.json().catch(() => null);
      setDocuments(docsJson?.ok ? docsJson.documents ?? [] : []);
      setFirstName(profile?.first_name ?? nextDriver?.first_name ?? "");
      setLastName(profile?.last_name ?? nextDriver?.last_name ?? "");
      setPhone(profile?.phone ?? nextDriver?.phone ?? "");
      setAltPhone(profile?.alt_phone ?? "");
      setIdNumber(profile?.id_number ?? "");
      setHomeAddress(profile?.home_address ?? "");
      setAreaName(profile?.area_name ?? "");
      setEmergencyName(profile?.emergency_contact_name ?? "");
      setEmergencyPhone(profile?.emergency_contact_phone ?? "");
      setLicenseNumber(profile?.license_number ?? "");
      setLicenseCode(profile?.license_code ?? "");
      setLicenseExpiry(profile?.license_expiry ?? "");
      setPdpNumber(profile?.pdp_number ?? "");
      setPdpExpiry(profile?.pdp_expiry ?? "");
      setPdpStatus(profile?.pdp_number ? "uploaded" : "not_available_yet");
      setVehicleMake(nextDriver?.vehicle_make ?? "");
      setVehicleModel(nextDriver?.vehicle_model ?? "");
      setVehicleYear(nextDriver?.vehicle_year ?? "");
      setVehicleColor(nextDriver?.vehicle_color ?? "");
      setVehicleRegistration(nextDriver?.vehicle_registration ?? "");
      setVehicleVin(nextDriver?.vehicle_vin ?? "");
      setVehicleEngine(nextDriver?.vehicle_engine_number ?? "");
      setSeatingCapacity(nextDriver?.seating_capacity ? String(nextDriver.seating_capacity) : "");
    } catch {
      setMsg("Could not load your driver application.");
    } finally {
      setBusy(false);
    }
  }, [getToken, router]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const readiness = useMemo(() => {
    const checks = [
      hasLicence === "yes",
      hasVehicle === "yes",
      Boolean(firstName && lastName && phone),
      Boolean(idNumber && homeAddress && areaName),
      Boolean(emergencyName && emergencyPhone),
      Boolean(licenseNumber && licenseCode && licenseExpiry),
      Boolean(vehicleMake && vehicleModel && vehicleRegistration),
      Boolean(vehicleYear && vehicleColor),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [
    areaName,
    emergencyName,
    emergencyPhone,
    firstName,
    hasLicence,
    hasVehicle,
    homeAddress,
    idNumber,
    lastName,
    licenseCode,
    licenseExpiry,
    licenseNumber,
    phone,
    vehicleColor,
    vehicleMake,
    vehicleModel,
    vehicleRegistration,
    vehicleYear,
  ]);

  const blockers = useMemo(() => {
    const items: string[] = [];
    if (hasLicence !== "yes") items.push("A valid driver licence is required.");
    if (hasVehicle !== "yes") items.push("Access to a roadworthy 4-door vehicle is required.");
    return items;
  }, [hasLicence, hasVehicle]);

  async function saveProfile(submit: boolean) {
    if (submit && blockers.length > 0) {
      setMsg(blockers[0]);
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/driver/login?next=/driver/complete-profile");
        return;
      }

      const res = await fetch("/api/driver/profile/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          phone,
          alt_phone: altPhone,
          id_number: idNumber,
          home_address: homeAddress,
          area_name: areaName,
          emergency_contact_name: emergencyName,
          emergency_contact_phone: emergencyPhone,
          license_number: licenseNumber,
          license_code: licenseCode,
          license_expiry: licenseExpiry,
          pdp_number: pdpStatus === "uploaded" ? pdpNumber : "",
          pdp_expiry: pdpStatus === "uploaded" ? pdpExpiry : "",
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vehicle_year: vehicleYear,
          vehicle_color: vehicleColor,
          vehicle_registration: vehicleRegistration,
          vehicle_vin: vehicleVin,
          vehicle_engine_number: vehicleEngine,
          seating_capacity: seatingCapacity,
          submit,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Could not save your application.");
        return;
      }

      setMsg(submit ? "Application submitted for MOOVU review." : "Draft saved.");
      if (submit) setTimeout(() => router.push("/driver"), 900);
    } catch {
      setMsg("Could not save your application.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadDocument(item: DriverDocumentItem, file: File | null) {
    if (!file) return;

    setUploadingDoc(item.label);
    setMsg(null);
    try {
      const token = await getToken();
      if (!token) {
        router.replace("/driver/login?next=/driver/complete-profile");
        return;
      }

      const form = new FormData();
      form.set("documentType", item.type);
      form.set("required", item.required ? "true" : "false");
      form.set("file", file);

      const res = await fetch("/api/driver/documents/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Could not upload this document.");
        return;
      }

      setMsg(`${item.label} uploaded for admin review.`);
      await loadProfile();
    } catch {
      setMsg("Could not upload this document.");
    } finally {
      setUploadingDoc(null);
    }
  }

  if (busy) {
    return (
      <main className="moovu-page min-h-screen p-5 text-slate-950">
        <section className="moovu-card mx-auto max-w-3xl p-6">Loading your MOOVU Driver application...</section>
      </main>
    );
  }

  return (
    <main className="moovu-page min-h-screen pb-28 text-slate-950">
      <div className="moovu-shell max-w-6xl space-y-6 py-6 sm:py-10">
        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        <section className="moovu-card overflow-hidden p-0">
          <div className="grid gap-5 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 sm:p-7 lg:grid-cols-[1fr_320px]">
            <div>
              <div className="moovu-section-title">Driver Application</div>
              <h1 className="mt-2 text-3xl font-black sm:text-4xl">Complete your MOOVU Driver application</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Continue your application, update missing details, track PDP / PrDP status, and submit for admin review.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <StatusPill label={driver?.verification_status ?? "draft"} />
                <StatusPill label={driver?.profile_completed ? "Profile submitted" : "Draft in progress"} />
              </div>
            </div>
            <div className="rounded-[2rem] bg-white p-5 shadow-[0_18px_50px_rgba(15,23,42,0.1)]">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Readiness score</div>
              <div className="mt-1 text-4xl font-black">{readiness}%</div>
              <div className="mt-4 h-3 rounded-full bg-slate-100">
                <div className="h-3 rounded-full bg-gradient-to-r from-[var(--moovu-primary)] to-emerald-400" style={{ width: `${readiness}%` }} />
              </div>
              <p className="mt-3 text-xs font-bold leading-5 text-slate-500">
                PDP / PrDP is visible to admin but does not block submission.
              </p>
            </div>
          </div>
        </section>

        <section className="moovu-card p-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {steps.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => setStep(index)}
                className={`min-w-fit rounded-2xl px-4 py-3 text-sm font-black ${
                  step === index
                    ? "bg-[var(--moovu-primary)] text-white"
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
            <Panel title="Eligibility Check" text="Confirm the operating requirements. PDP / PrDP is tracked but not a blocker.">
              <OptionGroup label="Do you have a valid driver licence?" value={hasLicence} onChange={setHasLicence} options={[["yes", "Yes"], ["no", "No"]]} />
              <OptionGroup label="Do you have access to a 4-door roadworthy vehicle?" value={hasVehicle} onChange={setHasVehicle} options={[["yes", "Yes"], ["no", "No"]]} />
              <OptionGroup label="Do you have a PDP / PrDP?" value={pdpStatus} onChange={(v) => setPdpStatus(v as typeof pdpStatus)} options={[["uploaded", "Yes, I have one"], ["not_available_yet", "No, not yet"], ["applying", "I am applying for one"]]} />
              <OptionGroup label="Are you willing to complete MOOVU onboarding/training?" value={trainingReady} onChange={setTrainingReady} options={[["yes", "Yes"], ["no", "No"]]} />
              {blockers.length > 0 && <Warning>{blockers.join(" ")}</Warning>}
            </Panel>
          )}

          {step === 1 && (
            <Panel title="Personal Details" text="Keep your contact and identity details up to date.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" value={firstName} onChange={setFirstName} />
                <Field label="Last name" value={lastName} onChange={setLastName} />
                <Field label="Cellphone number" value={phone} onChange={setPhone} />
                <Field label="Alternative phone" value={altPhone} onChange={setAltPhone} />
                <Field label="ID / passport number" value={idNumber} onChange={setIdNumber} />
                <Field label="Area / township" value={areaName} onChange={setAreaName} />
                <Field label="Residential address" value={homeAddress} onChange={setHomeAddress} className="sm:col-span-2" />
                <Field label="Emergency contact name" value={emergencyName} onChange={setEmergencyName} />
                <Field label="Emergency contact number" value={emergencyPhone} onChange={setEmergencyPhone} />
              </div>
            </Panel>
          )}

          {step === 2 && (
            <Panel title="Driver Documents" text="Required documents can be uploaded after the secure storage policies are applied. Admin can request re-uploads later.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Driver licence number" value={licenseNumber} onChange={setLicenseNumber} />
                <Field label="Licence code" value={licenseCode} onChange={setLicenseCode} placeholder="Code B / C1..." />
                <Field label="Licence expiry" value={licenseExpiry} onChange={setLicenseExpiry} type="date" />
                <Field label="PDP / PrDP number" value={pdpNumber} onChange={setPdpNumber} disabled={pdpStatus !== "uploaded"} />
                <Field label="PDP / PrDP expiry" value={pdpExpiry} onChange={setPdpExpiry} type="date" disabled={pdpStatus !== "uploaded"} />
              </div>
              <UploadChecklist
                title="Required uploads"
                items={requiredDocs}
                documents={documents}
                uploadingDoc={uploadingDoc}
                onUpload={uploadDocument}
              />
              <UploadChecklist
                title="Optional but tracked"
                items={optionalDocs}
                documents={documents}
                uploadingDoc={uploadingDoc}
                onUpload={uploadDocument}
              />
              {pdpStatus !== "uploaded" && <Warning>Do not have a PDP / PrDP yet? You can still submit. MOOVU may request it later.</Warning>}
            </Panel>
          )}

          {step === 3 && (
            <Panel title="Vehicle Details" text="Add the vehicle details MOOVU admin will review before approval.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Vehicle make" value={vehicleMake} onChange={setVehicleMake} />
                <Field label="Vehicle model" value={vehicleModel} onChange={setVehicleModel} />
                <Field label="Vehicle year" value={vehicleYear} onChange={setVehicleYear} />
                <Field label="Vehicle colour" value={vehicleColor} onChange={setVehicleColor} />
                <Field label="Number plate" value={vehicleRegistration} onChange={setVehicleRegistration} />
                <Field label="VIN" value={vehicleVin} onChange={setVehicleVin} />
                <Field label="Engine number" value={vehicleEngine} onChange={setVehicleEngine} />
                <Field label="Seating capacity" value={seatingCapacity} onChange={setSeatingCapacity} type="number" />
                <SelectField label="Ownership type" value={ownershipType} onChange={setOwnershipType} options={["owned", "rented", "fleet-owned", "borrowed"]} />
                <SelectField label="Vehicle category" value={vehicleCategory} onChange={setVehicleCategory} options={["MOOVU Go", "MOOVU Go XL", "Both if eligible"]} />
              </div>
              <UploadChecklist
                title="Vehicle documents"
                items={vehicleDocs}
                documents={documents}
                uploadingDoc={uploadingDoc}
                onUpload={uploadDocument}
              />
            </Panel>
          )}

          {step === 4 && (
            <Panel title="Vehicle Photos" text="MOOVU needs clear vehicle photos before the vehicle is cleared for trips.">
              <UploadChecklist
                title="Vehicle photo checklist"
                items={vehiclePhotos.map((item) => ({ ...item, label: `Vehicle photo - ${item.label}` }))}
                documents={documents}
                uploadingDoc={uploadingDoc}
                onUpload={uploadDocument}
              />
              <Warning>Photo uploads are tracked in the SQL/storage migration. Existing approved drivers are not affected.</Warning>
            </Panel>
          )}

          {step === 5 && (
            <Panel title="Review & Submit" text="Submit when the application is ready for admin review. You can save a draft at any time.">
              <div className="grid gap-4 md:grid-cols-2">
                <Summary title="Account and personal" rows={[["Name", `${firstName} ${lastName}`.trim() || "--"], ["Phone", phone || "--"], ["Area", areaName || "--"], ["Emergency", emergencyName || "--"]]} />
                <Summary title="Documents" rows={[["Licence", licenseNumber ? "Captured" : "Missing"], ["PDP / PrDP", pdpText(pdpStatus)], ["Proof uploads", "Pending review"]]} />
                <Summary title="Vehicle" rows={[["Vehicle", `${vehicleMake} ${vehicleModel}`.trim() || "--"], ["Plate", vehicleRegistration || "--"], ["Category", vehicleCategory], ["Ownership", ownershipType]]} />
                <Summary title="Admin readiness" rows={[["Readiness score", `${readiness}%`], ["Profile status", driver?.profile_completed ? "Submitted" : "Draft"], ["Verification", driver?.verification_status ?? "--"]]} />
              </div>
              {pdpStatus !== "uploaded" && <Warning>Your PDP / PrDP is not uploaded. Admin will see this warning but can still approve under MOOVU rules.</Warning>}
            </Panel>
          )}

          <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button className="moovu-btn moovu-btn-secondary justify-center" disabled={saving || step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}>
              Back
            </button>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button className="moovu-btn moovu-btn-secondary justify-center" disabled={saving} onClick={() => void saveProfile(false)}>
                {saving ? "Saving..." : "Save draft"}
              </button>
              {step < steps.length - 1 ? (
                <button className="moovu-btn moovu-btn-primary justify-center" onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>
                  Continue
                </button>
              ) : (
                <button className="moovu-btn moovu-btn-primary justify-center" disabled={saving} onClick={() => void saveProfile(true)}>
                  {saving ? "Submitting..." : "Submit for review"}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function pdpText(value: string) {
  if (value === "uploaded") return "Uploaded";
  if (value === "applying") return "Applying for one";
  return "Not available yet";
}

function Panel({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="space-y-5">
      <div>
        <div className="moovu-section-title">{title}</div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{text}</p>
      </div>
      {children}
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
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm font-black text-slate-700">{label}</span>
      <input
        className="moovu-input mt-2 disabled:bg-slate-100 disabled:text-slate-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        disabled={disabled}
      />
    </label>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
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

function OptionGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: [string, string][] }) {
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
                ? "border-[var(--moovu-primary)] bg-sky-50 text-[var(--moovu-primary)]"
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

function UploadChecklist({
  title,
  items,
  documents,
  uploadingDoc,
  onUpload,
}: {
  title: string;
  items: DriverDocumentItem[];
  documents: DriverDocument[];
  uploadingDoc: string | null;
  onUpload: (item: DriverDocumentItem, file: File | null) => void;
}) {
  return (
    <div>
      <h3 className="text-lg font-black">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const latest = documents.find((doc) => normalizeDriverDocumentType(doc.document_type || doc.doc_type) === item.type);
          const status = latest?.review_status || latest?.status || "missing";
          return (
            <div key={`${item.type}-${item.label}`} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-black text-slate-950">{item.label}</div>
                  <div className="mt-1 text-[11px] font-black uppercase tracking-[0.12em] text-slate-400">
                    {getDriverDocumentLabel(item.type)}
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-500">
                    {latest?.uploaded_at ? `Uploaded ${new Date(latest.uploaded_at).toLocaleDateString()}` : "No file uploaded yet"}
                  </div>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-black ${status === "approved" || status === "verified" ? "bg-emerald-50 text-emerald-700" : status === "rejected" || status === "needs_reupload" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                  {status.replaceAll("_", " ")}
                </span>
              </div>
              {latest?.rejection_reason && (
                <div className="mt-2 rounded-2xl bg-red-50 p-2 text-xs font-bold text-red-700">
                  {latest.rejection_reason}
                </div>
              )}
              <label className="mt-3 block">
                <span className="sr-only">Upload {item.label}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="block w-full text-xs font-bold text-slate-600 file:mr-3 file:rounded-xl file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-xs file:font-black file:text-[var(--moovu-primary)]"
                  disabled={uploadingDoc === item.label}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    onUpload(item, file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              {uploadingDoc === item.label && <div className="mt-2 text-xs font-black text-slate-500">Uploading...</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Summary({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="font-black">{title}</h3>
      <div className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-sm">
            <span className="font-bold text-slate-500">{label}</span>
            <span className="text-right font-black text-slate-900">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  return <span className="rounded-full bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-700 shadow-sm">{label.replaceAll("_", " ")}</span>;
}

function Warning({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-900">{children}</div>;
}
