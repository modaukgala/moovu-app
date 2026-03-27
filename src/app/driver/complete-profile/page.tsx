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
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | null;
  vehicle_color?: string | null;
  vehicle_registration?: string | null;
  vehicle_vin?: string | null;
  vehicle_engine_number?: string | null;
  seating_capacity?: number | null;
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
};

export default function DriverCompleteProfilePage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [driverId, setDriverId] = useState<string | null>(null);

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

  const requiredFilled = useMemo(() => {
    return !!(
      firstName.trim() &&
      lastName.trim() &&
      phone.trim() &&
      idNumber.trim() &&
      homeAddress.trim() &&
      areaName.trim() &&
      emergencyContactName.trim() &&
      emergencyContactPhone.trim() &&
      licenseNumber.trim() &&
      licenseCode.trim() &&
      licenseExpiry &&
      vehicleMake.trim() &&
      vehicleModel.trim() &&
      vehicleYear.trim() &&
      vehicleColor.trim() &&
      vehicleRegistration.trim()
    );
  }, [
    firstName,
    lastName,
    phone,
    idNumber,
    homeAddress,
    areaName,
    emergencyContactName,
    emergencyContactPhone,
    licenseNumber,
    licenseCode,
    licenseExpiry,
    vehicleMake,
    vehicleModel,
    vehicleYear,
    vehicleColor,
    vehicleRegistration,
  ]);

  async function loadData() {
    setLoading(true);
    setMsg(null);

    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
      router.replace("/driver/login");
      return;
    }

    const { data: mapping, error: mappingError } = await supabaseClient
      .from("driver_accounts")
      .select("driver_id")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (mappingError || !mapping?.driver_id) {
      setMsg("Your account is not linked to a driver yet. Ask admin to link your account first.");
      setLoading(false);
      return;
    }

    setDriverId(mapping.driver_id);

    const { data: driverData } = await supabaseClient
      .from("drivers")
      .select(`
        id,
        first_name,
        last_name,
        phone,
        profile_completed,
        verification_status,
        vehicle_make,
        vehicle_model,
        vehicle_year,
        vehicle_color,
        vehicle_registration,
        vehicle_vin,
        vehicle_engine_number,
        seating_capacity
      `)
      .eq("id", mapping.driver_id)
      .maybeSingle<Driver>();

    const { data: profileData } = await supabaseClient
      .from("driver_profiles")
      .select(`
        first_name,
        last_name,
        phone,
        alt_phone,
        id_number,
        home_address,
        area_name,
        emergency_contact_name,
        emergency_contact_phone,
        license_number,
        license_code,
        license_expiry,
        pdp_number,
        pdp_expiry
      `)
      .eq("driver_id", mapping.driver_id)
      .maybeSingle<ExistingProfile>();

    setFirstName(profileData?.first_name ?? driverData?.first_name ?? "");
    setLastName(profileData?.last_name ?? driverData?.last_name ?? "");
    setPhone(profileData?.phone ?? driverData?.phone ?? "");
    setAltPhone(profileData?.alt_phone ?? "");
    setIdNumber(profileData?.id_number ?? "");
    setHomeAddress(profileData?.home_address ?? "");
    setAreaName(profileData?.area_name ?? "");
    setEmergencyContactName(profileData?.emergency_contact_name ?? "");
    setEmergencyContactPhone(profileData?.emergency_contact_phone ?? "");
    setLicenseNumber(profileData?.license_number ?? "");
    setLicenseCode(profileData?.license_code ?? "");
    setLicenseExpiry(profileData?.license_expiry ?? "");
    setPdpNumber(profileData?.pdp_number ?? "");
    setPdpExpiry(profileData?.pdp_expiry ?? "");

    setVehicleMake(driverData?.vehicle_make ?? "");
    setVehicleModel(driverData?.vehicle_model ?? "");
    setVehicleYear(driverData?.vehicle_year ?? "");
    setVehicleColor(driverData?.vehicle_color ?? "");
    setVehicleRegistration(driverData?.vehicle_registration ?? "");
    setVehicleVin(driverData?.vehicle_vin ?? "");
    setVehicleEngineNumber(driverData?.vehicle_engine_number ?? "");
    setSeatingCapacity(
      driverData?.seating_capacity != null ? String(driverData.seating_capacity) : ""
    );

    setLoading(false);
  }

  async function saveProfile(submit: boolean) {
    setBusy(true);
    setMsg(null);

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session) {
        setMsg("Please log in again.");
        setBusy(false);
        return;
      }

      const res = await fetch("/api/driver/profile/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          phone,
          alt_phone: altPhone,
          id_number: idNumber,
          home_address: homeAddress,
          area_name: areaName,
          emergency_contact_name: emergencyContactName,
          emergency_contact_phone: emergencyContactPhone,
          license_number: licenseNumber,
          license_code: licenseCode,
          license_expiry: licenseExpiry,
          pdp_number: pdpNumber,
          pdp_expiry: pdpExpiry,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          vehicle_year: vehicleYear,
          vehicle_color: vehicleColor,
          vehicle_registration: vehicleRegistration,
          vehicle_vin: vehicleVin,
          vehicle_engine_number: vehicleEngineNumber,
          seating_capacity: seatingCapacity,
          submit,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setMsg("Profile save route is not returning JSON.");
        setBusy(false);
        return;
      }

      const json = await res.json();

      if (!json?.ok) {
        setMsg(json?.error || "Failed to save profile.");
        setBusy(false);
        return;
      }

      setMsg(submit ? "Profile submitted successfully ✅" : "Draft saved ✅");
      await loadData();
      setBusy(false);

      if (submit) {
        setTimeout(() => {
          router.push("/driver");
        }, 900);
      }
    } catch (e: any) {
      setMsg(e?.message || "Failed to save profile.");
      setBusy(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

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
            Save as draft any time, then submit when all required details are complete.
          </p>
          {driverId && (
            <p className="text-xs text-gray-500 mt-2">Driver ID: {driverId}</p>
          )}
        </div>

        {msg && (
          <div
            className="border rounded-2xl p-4 text-sm"
            style={{ background: "var(--moovu-primary-soft)" }}
          >
            {msg}
          </div>
        )}

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Personal Details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <input className="border rounded-xl p-3" placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Alternative phone" value={altPhone} onChange={(e) => setAltPhone(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="ID number" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Area / Township" value={areaName} onChange={(e) => setAreaName(e.target.value)} />
          </div>

          <input className="border rounded-xl p-3 w-full" placeholder="Home address" value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} />

          <div className="grid md:grid-cols-2 gap-4">
            <input className="border rounded-xl p-3" placeholder="Emergency contact name" value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Emergency contact phone" value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)} />
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Licence Details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <input className="border rounded-xl p-3" placeholder="License number" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="License code" value={licenseCode} onChange={(e) => setLicenseCode(e.target.value)} />
            <input className="border rounded-xl p-3" type="date" value={licenseExpiry} onChange={(e) => setLicenseExpiry(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="PDP number" value={pdpNumber} onChange={(e) => setPdpNumber(e.target.value)} />
            <input className="border rounded-xl p-3" type="date" value={pdpExpiry} onChange={(e) => setPdpExpiry(e.target.value)} />
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Vehicle Details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <input className="border rounded-xl p-3" placeholder="Vehicle make" value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Vehicle model" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Vehicle year" value={vehicleYear} onChange={(e) => setVehicleYear(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Vehicle color" value={vehicleColor} onChange={(e) => setVehicleColor(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Vehicle registration" value={vehicleRegistration} onChange={(e) => setVehicleRegistration(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Vehicle VIN" value={vehicleVin} onChange={(e) => setVehicleVin(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Engine number" value={vehicleEngineNumber} onChange={(e) => setVehicleEngineNumber(e.target.value)} />
            <input className="border rounded-xl p-3" placeholder="Seating capacity" value={seatingCapacity} onChange={(e) => setSeatingCapacity(e.target.value)} />
          </div>
        </section>

        <section className="border rounded-[2rem] p-6 bg-white shadow-sm">
          <div className="text-sm text-gray-600 mb-4">
            Required fields completed: {requiredFilled ? "Yes ✅" : "Not yet"}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="border rounded-xl px-4 py-2"
              disabled={busy}
              onClick={() => saveProfile(false)}
            >
              {busy ? "Saving..." : "Save Draft"}
            </button>

            <button
              className="rounded-xl px-4 py-2 text-white"
              style={{ background: "var(--moovu-primary)" }}
              disabled={busy || !requiredFilled}
              onClick={() => saveProfile(true)}
            >
              {busy ? "Submitting..." : "Submit Profile"}
            </button>

            <button
              className="border rounded-xl px-4 py-2"
              disabled={busy}
              onClick={() => router.push("/driver")}
            >
              Back
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}