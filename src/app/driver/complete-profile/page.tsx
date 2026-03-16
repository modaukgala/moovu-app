"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseClient } from "@/lib/supabase/client";

type Driver = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  profile_completed: boolean | null;
  verification_status: string | null;
};

type ExistingProfile = {
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
  profile_photo_url: string | null;
};

type UploadKey =
  | "id_document"
  | "drivers_license"
  | "vehicle_registration"
  | "car_front_photo"
  | "car_back_photo"
  | "car_side_photo"
  | "pdp_document"
  | "roadworthy_certificate"
  | "insurance_document"
  | "car_interior_photo"
  | "profile_photo";

const REQUIRED_DOCS: UploadKey[] = [
  "id_document",
  "drivers_license",
  "vehicle_registration",
  "car_front_photo",
  "car_back_photo",
  "car_side_photo",
];

const OPTIONAL_DOCS: UploadKey[] = [
  "pdp_document",
  "roadworthy_certificate",
  "insurance_document",
  "car_interior_photo",
];

function filePathFor(driverId: string, key: UploadKey, file: File) {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  return `${driverId}/${key}.${ext}`;
}

export default function DriverCompleteProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [driver, setDriver] = useState<Driver | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [homeAddress, setHomeAddress] = useState("");
  const [areaName, setAreaName] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");

  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseCode, setLicenseCode] = useState("");
  const [licenseExpiry, setLicenseExpiry] = useState("");
  const [pdpNumber, setPdpNumber] = useState("");
  const [pdpExpiry, setPdpExpiry] = useState("");

  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleRegistration, setVehicleRegistration] = useState("");
  const [vehicleVin, setVehicleVin] = useState("");
  const [vehicleEngineNumber, setVehicleEngineNumber] = useState("");
  const [seatingCapacity, setSeatingCapacity] = useState("");

  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);

  const [files, setFiles] = useState<Partial<Record<UploadKey, File | null>>>({
    id_document: null,
    drivers_license: null,
    vehicle_registration: null,
    car_front_photo: null,
    car_back_photo: null,
    car_side_photo: null,
    pdp_document: null,
    roadworthy_certificate: null,
    insurance_document: null,
    car_interior_photo: null,
    profile_photo: null,
  });

  const requiredReady = useMemo(() => REQUIRED_DOCS.every((k) => !!files[k]), [files]);

  function hardResetAuthAndRedirect() {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    window.location.href = "/driver/login";
  }

  async function safeGetSession() {
    try {
      const { data, error } = await supabaseClient.auth.getSession();

      if (error || !data.session) {
        try {
          await supabaseClient.auth.signOut({ scope: "local" });
        } catch {}
        hardResetAuthAndRedirect();
        return null;
      }

      return data.session;
    } catch {
      try {
        await supabaseClient.auth.signOut({ scope: "local" });
      } catch {}
      hardResetAuthAndRedirect();
      return null;
    }
  }

  async function loadLinkedDriver() {
    setLoading(true);
    setMsg(null);

    const session = await safeGetSession();
    if (!session) {
      setLoading(false);
      return null;
    }

    const res = await fetch("/api/driver/me", {
      method: "GET",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    const json = await res.json().catch(() => null);

    if (!json?.ok || !json?.driver) {
      setDriver(null);
      setMsg(json?.error || "Driver record missing.");
      setLoading(false);
      return null;
    }

    const linked = json.driver as Driver;
    setDriver(linked);

    const { data: p } = await supabaseClient
      .from("driver_profiles")
      .select(
        "first_name, last_name, phone, alt_phone, id_number, home_address, area_name, emergency_contact_name, emergency_contact_phone, license_number, license_code, license_expiry, pdp_number, pdp_expiry, profile_photo_url"
      )
      .eq("driver_id", linked.id)
      .maybeSingle<ExistingProfile>();

    setFirstName(p?.first_name ?? linked.first_name ?? "");
    setLastName(p?.last_name ?? linked.last_name ?? "");
    setPhone(p?.phone ?? linked.phone ?? "");
    setAltPhone(p?.alt_phone ?? "");
    setIdNumber(p?.id_number ?? "");
    setHomeAddress(p?.home_address ?? "");
    setAreaName(p?.area_name ?? "");
    setEmergencyContactName(p?.emergency_contact_name ?? "");
    setEmergencyContactPhone(p?.emergency_contact_phone ?? "");
    setLicenseNumber(p?.license_number ?? "");
    setLicenseCode(p?.license_code ?? "");
    setLicenseExpiry(p?.license_expiry ?? "");
    setPdpNumber(p?.pdp_number ?? "");
    setPdpExpiry(p?.pdp_expiry ?? "");

    const { data: vehicleData } = await supabaseClient
      .from("drivers")
      .select(
        "vehicle_make, vehicle_model, vehicle_year, vehicle_color, vehicle_registration, vehicle_vin, vehicle_engine_number, seating_capacity"
      )
      .eq("id", linked.id)
      .single();

    setVehicleMake(vehicleData?.vehicle_make ?? "");
    setVehicleModel(vehicleData?.vehicle_model ?? "");
    setVehicleYear(vehicleData?.vehicle_year ?? "");
    setVehicleColor(vehicleData?.vehicle_color ?? "");
    setVehicleRegistration(vehicleData?.vehicle_registration ?? "");
    setVehicleVin(vehicleData?.vehicle_vin ?? "");
    setVehicleEngineNumber(vehicleData?.vehicle_engine_number ?? "");
    setSeatingCapacity(vehicleData?.seating_capacity != null ? String(vehicleData.seating_capacity) : "");

    setLoading(false);
    return linked;
  }

  useEffect(() => {
    loadLinkedDriver();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPickedFile(key: UploadKey, file: File | null) {
    setFiles((prev) => ({ ...prev, [key]: file }));
  }

  async function upsertDriverDocument(row: any) {
    // Try upsert first (best), fallback to insert if no unique constraint exists
    const upsertRes = await supabaseClient
      .from("driver_documents")
      .upsert(row, { onConflict: "driver_id,document_type" });

    if (!upsertRes.error) return;

    const msg = upsertRes.error.message || "";
    const noConstraint =
      msg.toLowerCase().includes("no unique") ||
      msg.toLowerCase().includes("on conflict");

    if (!noConstraint) {
      throw new Error(upsertRes.error.message);
    }

    // Fallback: insert (duplicates might happen, but at least it saves)
    const ins = await supabaseClient.from("driver_documents").insert(row);
    if (ins.error) throw new Error(ins.error.message);
  }

  async function uploadOne(driverId: string, key: UploadKey, file: File, isRequired: boolean) {
    const isPhoto =
      key === "car_front_photo" ||
      key === "car_back_photo" ||
      key === "car_side_photo" ||
      key === "car_interior_photo";

    const bucket = isPhoto ? "vehicle-photos" : "driver-documents";
    const path = filePathFor(driverId, key, file);

    const { error: uploadErr } = await supabaseClient.storage
      .from(bucket)
      .upload(path, file, { upsert: true });

    if (uploadErr) {
      throw new Error(`${key}: ${uploadErr.message}`);
    }

    const { data } = supabaseClient.storage.from(bucket).getPublicUrl(path);
    const fileUrl = data?.publicUrl || path;

    await upsertDriverDocument({
      driver_id: driverId,
      document_type: key,
      file_url: fileUrl,
      original_name: file.name,
      mime_type: file.type || null,
      file_size_bytes: file.size || null,
      is_required: isRequired,
      review_status: "pending",
    });

    return fileUrl;
  }

  async function uploadProfilePhoto(driverId: string, file: File) {
    const path = filePathFor(driverId, "profile_photo", file);

    const { error: uploadErr } = await supabaseClient.storage
      .from("driver-documents")
      .upload(path, file, { upsert: true });

    if (uploadErr) {
      throw new Error(`profile_photo: ${uploadErr.message}`);
    }

    const { data } = supabaseClient.storage.from("driver-documents").getPublicUrl(path);
    return data?.publicUrl || path;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    setMsg(null);

    const linkedDriver = driver ?? (await loadLinkedDriver());
    if (!linkedDriver?.id) {
      setMsg("Driver record missing.");
      return;
    }

    const driverId = linkedDriver.id;

    // required fields
    if (
      !firstName.trim() ||
      !lastName.trim() ||
      !phone.trim() ||
      !idNumber.trim() ||
      !homeAddress.trim() ||
      !areaName.trim() ||
      !emergencyContactName.trim() ||
      !emergencyContactPhone.trim() ||
      !licenseNumber.trim() ||
      !licenseCode.trim() ||
      !licenseExpiry ||
      !vehicleMake.trim() ||
      !vehicleModel.trim() ||
      !vehicleYear.trim() ||
      !vehicleColor.trim() ||
      !vehicleRegistration.trim()
    ) {
      setMsg("Please complete all required text fields.");
      return;
    }

    if (!requiredReady) {
      setMsg("Please upload all required documents and car photos.");
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      let profilePhotoUrl: string | null = null;

      if (profilePhoto) {
        profilePhotoUrl = await uploadProfilePhoto(driverId, profilePhoto);
      }

      // Upload required + optional docs selected in the form
      const allUploads: Array<{ key: UploadKey; file: File | null; required: boolean }> = [
        ...REQUIRED_DOCS.map((k) => ({ key: k, file: files[k] ?? null, required: true })),
        ...OPTIONAL_DOCS.map((k) => ({ key: k, file: files[k] ?? null, required: false })),
      ];

      for (const item of allUploads) {
        if (item.file) {
          await uploadOne(driverId, item.key, item.file, item.required);
        }
      }

      // Save driver_profiles
      const { error: profileErr } = await supabaseClient.from("driver_profiles").upsert(
        {
          driver_id: driverId,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
          alt_phone: altPhone.trim() || null,
          id_number: idNumber.trim(),
          home_address: homeAddress.trim(),
          area_name: areaName.trim(),
          emergency_contact_name: emergencyContactName.trim(),
          emergency_contact_phone: emergencyContactPhone.trim(),
          license_number: licenseNumber.trim(),
          license_code: licenseCode.trim(),
          license_expiry: licenseExpiry,
          pdp_number: pdpNumber.trim() || null,
          pdp_expiry: pdpExpiry || null,
          profile_photo_url: profilePhotoUrl,
          profile_completed: true,
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );

      if (profileErr) throw new Error(profileErr.message);

      // Save drivers table (vehicle fields + completion flags)
      const { error: driverErr } = await supabaseClient
        .from("drivers")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          phone: phone.trim(),
          vehicle_make: vehicleMake.trim(),
          vehicle_model: vehicleModel.trim(),
          vehicle_year: vehicleYear.trim(),
          vehicle_color: vehicleColor.trim(),
          vehicle_registration: vehicleRegistration.trim(),
          vehicle_vin: vehicleVin.trim() || null,
          vehicle_engine_number: vehicleEngineNumber.trim() || null,
          seating_capacity: seatingCapacity ? Number(seatingCapacity) : null,
          profile_completed: true,
          verification_status: "pending_review",
        })
        .eq("id", driverId);

      if (driverErr) throw new Error(driverErr.message);

      setMsg("Profile submitted successfully ✅");
      setSaving(false);

      // refresh local state to reflect updated profile_completed
      await loadLinkedDriver();

      setTimeout(() => {
        router.push("/driver");
      }, 800);
    } catch (error: any) {
      setSaving(false);
      setMsg(error?.message ?? "Failed to submit profile");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen px-6 py-10 text-black">
        <div className="max-w-4xl mx-auto border rounded-[2rem] p-6 bg-white shadow-sm">
          Loading profile form...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 text-black">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <div className="text-sm text-gray-500">Driver Onboarding</div>
          <h1 className="text-3xl font-semibold mt-1">Complete Your Driver Profile</h1>
          <p className="text-gray-700 mt-2">
            Fill in your details and upload the required documents so MOOVU can review your profile.
          </p>
        </div>

        {msg && (
          <div className="border rounded-2xl p-4 text-sm text-black" style={{ background: "var(--moovu-primary-soft)" }}>
            {msg}
          </div>
        )}

        {!driver && (
          <div className="border rounded-2xl p-4 text-black" style={{ background: "var(--moovu-primary-soft)" }}>
            Driver record missing.
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-6">
          <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Personal Details</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <input className="rounded-xl p-3 border" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Alternative phone number" value={altPhone} onChange={(e) => setAltPhone(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="ID number / passport" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Area / township" value={areaName} onChange={(e) => setAreaName(e.target.value)} />
            </div>

            <textarea className="rounded-xl p-3 w-full min-h-[110px] border" placeholder="Home address" value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} />

            <div className="grid md:grid-cols-2 gap-4">
              <input className="rounded-xl p-3 border" placeholder="Emergency contact name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Emergency contact phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-2">Profile photo (optional)</label>
              <input type="file" accept="image/*" onChange={(e) => setProfilePhoto(e.target.files?.[0] ?? null)} />
            </div>
          </section>

          <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Driver License Details</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <input className="rounded-xl p-3 border" placeholder="License number" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="License code / class" value={licenseCode} onChange={(e) => setLicenseCode(e.target.value)} />
              <div>
                <label className="block text-sm text-gray-600 mb-2">License expiry</label>
                <input className="rounded-xl p-3 border w-full" type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
              </div>
              <input className="rounded-xl p-3 border" placeholder="PDP number (optional)" value={pdpNumber} onChange={(e) => setPdpNumber(e.target.value)} />
              <div>
                <label className="block text-sm text-gray-600 mb-2">PDP expiry (optional)</label>
                <input className="rounded-xl p-3 border w-full" type="date" value={pdpExpiry} onChange={(e) => setPdpExpiry(e.target.value)} />
              </div>
            </div>
          </section>

          <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Vehicle Details</h2>

            <div className="grid md:grid-cols-2 gap-4">
              <input className="rounded-xl p-3 border" placeholder="Vehicle make" value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Vehicle model" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Vehicle year" value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Vehicle color" value={vehicleColor} onChange={(e) => setVehicleColor(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Registration number" value={vehicleRegistration} onChange={(e) => setVehicleRegistration(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="VIN / chassis number (optional)" value={vehicleVin} onChange={(e) => setVehicleVin(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Engine number (optional)" value={vehicleEngineNumber} onChange={(e) => setVehicleEngineNumber(e.target.value)} />
              <input className="rounded-xl p-3 border" placeholder="Seating capacity (optional)" value={seatingCapacity} onChange={(e) => setSeatingCapacity(e.target.value)} />
            </div>
          </section>

          <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Required Uploads</h2>
            <p className="text-sm text-gray-700">These are required before MOOVU can review your profile.</p>

            <div className="grid md:grid-cols-2 gap-4">
              <UploadField label="ID document" onPick={(file) => setPickedFile("id_document", file)} />
              <UploadField label="Driver's license" onPick={(file) => setPickedFile("drivers_license", file)} />
              <UploadField label="Vehicle registration" onPick={(file) => setPickedFile("vehicle_registration", file)} />
              <UploadField label="Car front photo" onPick={(file) => setPickedFile("car_front_photo", file)} />
              <UploadField label="Car back photo" onPick={(file) => setPickedFile("car_back_photo", file)} />
              <UploadField label="Car side photo" onPick={(file) => setPickedFile("car_side_photo", file)} />
            </div>
          </section>

          <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
            <h2 className="text-xl font-semibold">Optional Uploads</h2>
            <p className="text-sm text-gray-700">Optional documents can be uploaded now or later.</p>

            <div className="grid md:grid-cols-2 gap-4">
              <UploadField label="PDP document" onPick={(file) => setPickedFile("pdp_document", file)} />
              <UploadField label="Roadworthy certificate" onPick={(file) => setPickedFile("roadworthy_certificate", file)} />
              <UploadField label="Insurance document" onPick={(file) => setPickedFile("insurance_document", file)} />
              <UploadField label="Car interior photo" onPick={(file) => setPickedFile("car_interior_photo", file)} />
            </div>
          </section>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl px-5 py-3 text-white"
              style={{ background: "var(--moovu-primary)" }}
            >
              {saving ? "Submitting..." : "Submit Profile"}
            </button>

            <button type="button" className="border rounded-xl px-5 py-3 bg-white" onClick={() => router.push("/driver")}>
              Back to Dashboard
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

function UploadField({ label, onPick }: { label: string; onPick: (file: File | null) => void }) {
  return (
    <div className="border rounded-2xl p-4 bg-white">
      <label className="block text-sm text-gray-600 mb-2">{label}</label>
      <input type="file" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </div>
  );
}