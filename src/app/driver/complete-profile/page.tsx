"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DriverBottomNav from "@/components/app-shell/DriverBottomNav";
import { supabaseClient } from "@/lib/supabase/client";
import CenteredMessageBox from "@/components/ui/CenteredMessageBox";
import LoadingState from "@/components/ui/LoadingState";

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
  driver_id?: string | null;
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
  profile_completed?: boolean | null;
  submitted_at?: string | null;
  updated_at?: string | null;
};

type LoadProfileResponse = {
  ok: boolean;
  error?: string;
  driverId?: string;
  driver?: Driver | null;
  profile?: ExistingProfile | null;
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

  const hydrateForm = useCallback((driverData?: Driver | null, profileData?: ExistingProfile | null) => {
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
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setMsg(null);

    try {
      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session) {
        router.replace("/driver/login");
        return;
      }

      const res = await fetch("/api/driver/profile", {
        method: "GET",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        setMsg("Profile load route is not returning JSON.");
        setLoading(false);
        return;
      }

      const json = (await res.json()) as LoadProfileResponse;

      if (!json?.ok) {
        setMsg(json?.error || "Failed to load profile.");
        setLoading(false);
        return;
      }

      setDriverId(json.driverId ?? null);
      hydrateForm(json.driver ?? null, json.profile ?? null);
    } catch (error: unknown) {
      setMsg(error instanceof Error ? error.message : "Failed to load profile.");
    }

    setLoading(false);
  }, [hydrateForm, router]);

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

      setMsg(submit ? "Profile submitted successfully." : "Draft saved.");
      await loadData();
      setBusy(false);

      if (submit) {
        setTimeout(() => {
          router.push("/driver");
        }, 900);
      }
    } catch (error: unknown) {
      setMsg(error instanceof Error ? error.message : "Failed to save profile.");
      setBusy(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  if (loading) {
    return (
      <LoadingState
        title="Loading driver profile"
        description="Preparing saved personal, licence, and vehicle details."
      />
    );
  }

  return (
    <main className="moovu-page moovu-driver-shell text-black">
      <div className="moovu-shell max-w-5xl space-y-6">
        <div className="moovu-card p-5 sm:p-6">
          <div className="moovu-section-title">Driver onboarding</div>
          <h1 className="mt-2 text-2xl font-black text-slate-950 sm:text-3xl">
            Complete your driver profile
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Save as draft any time, then submit when all required details are complete.
          </p>
          {driverId && <p className="text-xs text-gray-500 mt-2">Driver ID: {driverId}</p>}
        </div>

        {msg && <CenteredMessageBox message={msg} onClose={() => setMsg(null)} />}

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Personal details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="border rounded-xl p-3"
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Alternative phone"
              value={altPhone}
              onChange={(e) => setAltPhone(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="ID number"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Area / Township"
              value={areaName}
              onChange={(e) => setAreaName(e.target.value)}
            />
          </div>

          <input
            className="border rounded-xl p-3 w-full"
            placeholder="Home address"
            value={homeAddress}
            onChange={(e) => setHomeAddress(e.target.value)}
          />

          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="border rounded-xl p-3"
              placeholder="Emergency contact name"
              value={emergencyContactName}
              onChange={(e) => setEmergencyContactName(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Emergency contact phone"
              value={emergencyContactPhone}
              onChange={(e) => setEmergencyContactPhone(e.target.value)}
            />
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Licence details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="border rounded-xl p-3"
              placeholder="License number"
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="License code"
              value={licenseCode}
              onChange={(e) => setLicenseCode(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              type="date"
              value={licenseExpiry}
              onChange={(e) => setLicenseExpiry(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="PDP number"
              value={pdpNumber}
              onChange={(e) => setPdpNumber(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              type="date"
              value={pdpExpiry}
              onChange={(e) => setPdpExpiry(e.target.value)}
            />
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6 space-y-4">
          <h2 className="text-xl font-black text-slate-950">Vehicle details</h2>

          <div className="grid md:grid-cols-2 gap-4">
            <input
              className="border rounded-xl p-3"
              placeholder="Vehicle make"
              value={vehicleMake}
              onChange={(e) => setVehicleMake(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Vehicle model"
              value={vehicleModel}
              onChange={(e) => setVehicleModel(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Vehicle year"
              value={vehicleYear}
              onChange={(e) => setVehicleYear(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Vehicle color"
              value={vehicleColor}
              onChange={(e) => setVehicleColor(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Vehicle registration"
              value={vehicleRegistration}
              onChange={(e) => setVehicleRegistration(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Vehicle VIN"
              value={vehicleVin}
              onChange={(e) => setVehicleVin(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Engine number"
              value={vehicleEngineNumber}
              onChange={(e) => setVehicleEngineNumber(e.target.value)}
            />
            <input
              className="border rounded-xl p-3"
              placeholder="Seating capacity"
              value={seatingCapacity}
              onChange={(e) => setSeatingCapacity(e.target.value)}
            />
          </div>
        </section>

        <section className="moovu-card p-5 sm:p-6">
          <div className="text-sm text-gray-600 mb-4">
            Required fields completed: {requiredFilled ? "Yes" : "Not yet"}
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
      <DriverBottomNav />
    </main>
  );
}
