"use client";

import { useEffect, useMemo, useState } from "react";
import { waLinkZA } from "@/lib/whatsapp";

type Application = {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  linked_driver_id: string | null;
};

type DriverOpt = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: string | null;
  online: boolean | null;
  busy: boolean | null;
  created_at: string | null;
};

type DriverProfile = {
  driver_id: string;
  driver_first_name: string | null;
  driver_last_name: string | null;
  driver_phone: string | null;
  driver_status: string | null;
  profile_completed: boolean | null;
  verification_status: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_color: string | null;
  vehicle_registration: string | null;
  profile_id: string | null;
  id_number: string | null;
  area_name: string | null;
  home_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  license_number: string | null;
  license_code: string | null;
  license_expiry: string | null;
  pdp_number: string | null;
  pdp_expiry: string | null;
  profile_photo_url: string | null;
  submitted_at: string | null;
  total_documents: number | null;
  required_documents_uploaded: number | null;
};

type DriverDocument = {
  id: string;
  driver_id: string;
  document_type: string;
  file_url: string;
  original_name: string | null;
  review_status: string | null;
  is_required: boolean | null;
  uploaded_at: string | null;
};

const REQUIRED_DOC_TYPES = [
  "id_document",
  "drivers_license",
  "vehicle_registration",
  "car_front_photo",
  "car_back_photo",
  "car_side_photo",
];

function docLabel(type: string) {
  const map: Record<string, string> = {
    id_document: "ID Document",
    drivers_license: "Driver's License",
    vehicle_registration: "Vehicle Registration",
    car_front_photo: "Car Front Photo",
    car_back_photo: "Car Back Photo",
    car_side_photo: "Car Side Photo",
    pdp_document: "PDP Document",
    roadworthy_certificate: "Roadworthy Certificate",
    insurance_document: "Insurance Document",
    car_interior_photo: "Car Interior Photo",
    profile_photo: "Profile Photo",
    other: "Other",
  };
  return map[type] ?? type;
}

export default function AdminApplicationsPage() {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [apps, setApps] = useState<Application[]>([]);
  const [drivers, setDrivers] = useState<DriverOpt[]>([]);

  const [selected, setSelected] = useState<Application | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState("");

  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [documents, setDocuments] = useState<DriverDocument[]>([]);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function loadApplications() {
    setMsg(null);
    const qs = status === "all" ? "" : `?status=${status}`;
    const res = await fetch(`/api/admin/applications${qs}`);
    const json = await res.json();
    if (!json.ok) {
      setApps([]);
      setMsg(json.error || "Failed to load applications");
      return;
    }
    setApps(json.applications ?? []);
  }

  async function loadDrivers() {
    const res = await fetch("/api/admin/drivers/options");
    const json = await res.json();
    if (json.ok) setDrivers(json.drivers ?? []);
  }

  async function loadLinkedDriverProfile(driverId: string) {
    setProfile(null);
    setDocuments([]);

    const [profileRes, docsRes] = await Promise.all([
      fetch(`/api/admin/driver-profile?driverId=${encodeURIComponent(driverId)}`),
      fetch(`/api/admin/driver-documents?driverId=${encodeURIComponent(driverId)}`),
    ]);

    const profileJson = await profileRes.json();
    const docsJson = await docsRes.json();

    if (profileJson.ok) setProfile(profileJson.profile ?? null);
    if (docsJson.ok) setDocuments(docsJson.documents ?? []);
  }

  useEffect(() => {
    loadDrivers();
  }, []);

  useEffect(() => {
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (!selected?.linked_driver_id) {
      setProfile(null);
      setDocuments([]);
      return;
    }
    loadLinkedDriverProfile(selected.linked_driver_id);
  }, [selected?.linked_driver_id]);

  const selectedDriverLabel = useMemo(() => {
    const d = drivers.find((x) => x.id === selectedDriverId);
    if (!d) return null;
    const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
    return `${name} • ${d.phone ?? "—"} • ${d.status ?? "—"}`;
  }, [drivers, selectedDriverId]);

  const requiredDocsProgress = useMemo(() => {
    const uploaded = new Set(documents.filter((d) => d.is_required).map((d) => d.document_type));
    const count = REQUIRED_DOC_TYPES.filter((x) => uploaded.has(x)).length;
    return `${count}/${REQUIRED_DOC_TYPES.length}`;
  }, [documents]);

  async function doAction(action: "approve" | "reject" | "link" | "unlink") {
    if (!selected) return;

    setBusy(true);
    setMsg(null);

    const payload: any = { action, applicationId: selected.id, userId: selected.user_id };
    if (action === "link") payload.driverId = selectedDriverId;

    const res = await fetch("/api/admin/applications/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Action failed");
      return;
    }

    setMsg(`✅ ${json.message}`);
    await loadApplications();

    const updatedSelected =
      apps.find((a) => a.id === selected.id) ??
      (selected ? { ...selected, linked_driver_id: action === "unlink" ? null : selected.linked_driver_id } : null);

    if (updatedSelected) setSelected(updatedSelected);
  }

  async function createDriverFromApplication() {
    if (!selected) return;

    setBusy(true);
    setMsg(null);

    const res = await fetch("/api/admin/applications/create-driver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: selected.id }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Create driver failed");
      return;
    }

    setMsg(`✅ ${json.message} (Driver UUID: ${json.driverId ?? "—"})`);
    await loadDrivers();
    await loadApplications();

    if (json.driverId && selected) {
      setSelected({ ...selected, linked_driver_id: json.driverId, status: "approved" });
      await loadLinkedDriverProfile(json.driverId);
    }
  }

  async function updateVerificationStatus(newStatus: "pending_review" | "approved" | "needs_more_info" | "rejected") {
    if (!selected?.linked_driver_id) return;

    setBusy(true);
    setMsg(null);

    const res = await fetch("/api/admin/driver-verification", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        driverId: selected.linked_driver_id,
        verificationStatus: newStatus,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Failed to update verification status");
      return;
    }

    setMsg(`✅ Verification updated to ${newStatus}`);
    await loadLinkedDriverProfile(selected.linked_driver_id);
  }

  async function updateDocumentReviewStatus(
    documentId: string,
    reviewStatus: "approved" | "rejected" | "needs_reupload" | "pending"
  ) {
    setBusy(true);
    setMsg(null);

    const res = await fetch("/api/admin/driver-document-review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        documentId,
        reviewStatus,
      }),
    });

    const json = await res.json();
    setBusy(false);

    if (!json.ok) {
      setMsg(json.error || "Failed to update document");
      return;
    }

    setMsg(`✅ Document updated`);
    if (selected?.linked_driver_id) {
      await loadLinkedDriverProfile(selected.linked_driver_id);
    }
  }

  const waHref = useMemo(() => {
    if (!selected?.phone) return null;
    const message = selected.linked_driver_id
      ? `Hi ${selected.full_name ?? ""}. Your MOOVU driver account is approved and linked. You can now login at https://driver.moovurides.co.za/login`
      : `Hi ${selected.full_name ?? ""}. Your MOOVU driver application is received. We will approve and link your account soon.`;
    return waLinkZA(selected.phone, message);
  }, [selected]);

  return (
    <main className="space-y-6 text-black">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm text-gray-500">Driver Onboarding</div>
          <h1 className="text-3xl font-semibold mt-1">Driver Applications</h1>
          <p className="text-gray-700 mt-2">
            Approve, link, review profile details, inspect documents and notify applicants.
          </p>
        </div>

        <div className="flex gap-2">
          <select
            className="border rounded-xl px-4 py-2 bg-white text-black"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>

          <button
            className="rounded-xl px-4 py-2 text-white"
            style={{ background: "var(--moovu-primary)" }}
            onClick={loadApplications}
          >
            Refresh
          </button>
        </div>
      </div>

      {msg && (
        <div
          className="border rounded-2xl p-4 text-sm text-black"
          style={{ background: "var(--moovu-primary-soft)" }}
        >
          {msg}
        </div>
      )}

      <div className="grid xl:grid-cols-[0.9fr_1.1fr] gap-6">
        <section className="border rounded-[2rem] p-5 bg-white shadow-sm">
          <div className="mb-4">
            <div className="text-sm text-gray-500">Applications Queue</div>
            <h2 className="text-xl font-semibold mt-1">Applications ({apps.length})</h2>
          </div>

          {apps.length === 0 ? (
            <p className="text-gray-700">No applications found.</p>
          ) : (
            <div className="space-y-3">
              {apps.map((a) => {
                const linked = !!a.linked_driver_id;
                return (
                  <button
                    key={a.id}
                    onClick={() => {
                      setSelected(a);
                      setSelectedDriverId("");
                      setMsg(null);
                    }}
                    className={`w-full text-left border rounded-2xl p-4 transition ${
                      selected?.id === a.id ? "ring-2 ring-offset-0" : ""
                    }`}
                    style={
                      selected?.id === a.id
                        ? { borderColor: "var(--moovu-primary)", boxShadow: "0 0 0 2px rgba(47,128,237,0.18)" }
                        : undefined
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{a.full_name ?? "Unnamed driver"}</div>
                      <div className="text-xs text-gray-500">{new Date(a.created_at).toLocaleString()}</div>
                    </div>

                    <div className="text-sm text-gray-700 mt-1">
                      {a.email ?? "—"} • {a.phone ?? "—"} • <span className="capitalize">{a.status}</span>
                    </div>

                    <div className="text-xs mt-2 text-gray-600">
                      Link status:{" "}
                      <span className="font-medium text-black">
                        {linked ? `Linked ✅ (${a.linked_driver_id})` : "Not linked"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="border rounded-[2rem] p-5 bg-white shadow-sm">
          <div className="mb-4">
            <div className="text-sm text-gray-500">Application Review</div>
            <h2 className="text-xl font-semibold mt-1">Details</h2>
          </div>

          {!selected ? (
            <p className="text-gray-700">Select an application.</p>
          ) : (
            <div className="space-y-5">
              <div className="border rounded-2xl p-4 bg-white space-y-2">
                <div className="text-sm text-gray-600">Full name</div>
                <div className="font-medium">{selected.full_name ?? "—"}</div>

                <div className="text-sm text-gray-600 mt-3">Email</div>
                <div className="font-medium">{selected.email ?? "—"}</div>

                <div className="text-sm text-gray-600 mt-3">Phone</div>
                <div className="font-medium">{selected.phone ?? "—"}</div>

                <div className="text-sm text-gray-600 mt-3">Status</div>
                <div className="font-medium capitalize">{selected.status}</div>

                <div className="text-sm text-gray-600 mt-3">Link status</div>
                <div className="font-medium">
                  {selected.linked_driver_id ? `Linked ✅ (${selected.linked_driver_id})` : "Not linked"}
                </div>

                {selected.notes ? (
                  <>
                    <div className="text-sm text-gray-600 mt-3">Notes</div>
                    <div className="font-medium">{selected.notes}</div>
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-xl px-4 py-2 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                  disabled={busy}
                  onClick={() => doAction("approve")}
                >
                  Approve
                </button>

                <button
                  className="border rounded-xl px-4 py-2 bg-white text-black"
                  disabled={busy}
                  onClick={() => doAction("reject")}
                >
                  Reject
                </button>

                <button
                  className="border rounded-xl px-4 py-2 bg-white text-black"
                  disabled={busy}
                  onClick={() => doAction("unlink")}
                >
                  Unlink
                </button>

                {waHref ? (
                  <a className="border rounded-xl px-4 py-2 bg-white text-black" href={waHref} target="_blank" rel="noreferrer">
                    WhatsApp Notify
                  </a>
                ) : (
                  <button className="border rounded-xl px-4 py-2 opacity-50" disabled>
                    WhatsApp Notify
                  </button>
                )}
              </div>

              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Create Driver Profile (fast)</div>
                <p className="text-sm text-gray-700">
                  Creates a driver, links the account, and approves the application.
                </p>
                <button
                  className="rounded-xl px-4 py-2 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                  disabled={busy || !!selected.linked_driver_id}
                  onClick={createDriverFromApplication}
                >
                  Create Driver + Link + Approve
                </button>
              </div>

              <div className="border rounded-2xl p-4 space-y-3">
                <div className="font-semibold">Manual Link to Driver UUID</div>

                <select
                  className="border rounded-xl p-3 bg-white w-full text-black"
                  value={selectedDriverId}
                  onChange={(e) => setSelectedDriverId(e.target.value)}
                >
                  <option value="">Select driver...</option>
                  {drivers.map((d) => {
                    const name = `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim() || "Unnamed";
                    return (
                      <option key={d.id} value={d.id}>
                        {name} • {d.phone ?? "—"} • {d.id}
                      </option>
                    );
                  })}
                </select>

                {selectedDriverLabel && <div className="text-sm text-gray-700">Selected: {selectedDriverLabel}</div>}

                <button
                  className="rounded-xl px-4 py-2 text-white"
                  style={{ background: "var(--moovu-primary)" }}
                  disabled={busy || !selectedDriverId}
                  onClick={() => doAction("link")}
                >
                  Link (and approve)
                </button>
              </div>

              {selected.linked_driver_id && (
                <>
                  <div className="border rounded-2xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold">Driver Profile</div>
                        <div className="text-sm text-gray-700">
                          Full onboarding data submitted by the linked driver.
                        </div>
                      </div>

                      {profile && (
                        <div className="text-sm text-gray-700">
                          Required docs: <span className="font-semibold text-black">{requiredDocsProgress}</span>
                        </div>
                      )}
                    </div>

                    {!profile ? (
                      <div className="text-sm text-gray-700">No completed profile found yet.</div>
                    ) : (
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="border rounded-2xl p-4">
                          <div className="text-sm text-gray-600">Driver</div>
                          <div className="font-medium mt-1">
                            {profile.driver_first_name ?? "—"} {profile.driver_last_name ?? ""}
                          </div>

                          <div className="text-sm text-gray-600 mt-3">Phone</div>
                          <div className="font-medium mt-1">{profile.driver_phone ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">Verification</div>
                          <div className="font-medium mt-1">{profile.verification_status ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">Profile completed</div>
                          <div className="font-medium mt-1">{profile.profile_completed ? "Yes" : "No"}</div>

                          <div className="text-sm text-gray-600 mt-3">Submitted</div>
                          <div className="font-medium mt-1">
                            {profile.submitted_at ? new Date(profile.submitted_at).toLocaleString() : "—"}
                          </div>
                        </div>

                        <div className="border rounded-2xl p-4">
                          <div className="text-sm text-gray-600">Vehicle</div>
                          <div className="font-medium mt-1">
                            {profile.vehicle_color ?? "—"} {profile.vehicle_make ?? ""} {profile.vehicle_model ?? ""}
                          </div>

                          <div className="text-sm text-gray-600 mt-3">Year</div>
                          <div className="font-medium mt-1">{profile.vehicle_year ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">Registration</div>
                          <div className="font-medium mt-1">{profile.vehicle_registration ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">Area</div>
                          <div className="font-medium mt-1">{profile.area_name ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">Address</div>
                          <div className="font-medium mt-1">{profile.home_address ?? "—"}</div>
                        </div>

                        <div className="border rounded-2xl p-4">
                          <div className="text-sm text-gray-600">Identity</div>
                          <div className="font-medium mt-1">{profile.id_number ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">License number</div>
                          <div className="font-medium mt-1">{profile.license_number ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">License code</div>
                          <div className="font-medium mt-1">{profile.license_code ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">License expiry</div>
                          <div className="font-medium mt-1">{profile.license_expiry ?? "—"}</div>
                        </div>

                        <div className="border rounded-2xl p-4">
                          <div className="text-sm text-gray-600">Emergency contact</div>
                          <div className="font-medium mt-1">{profile.emergency_contact_name ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">Emergency phone</div>
                          <div className="font-medium mt-1">{profile.emergency_contact_phone ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">PDP number</div>
                          <div className="font-medium mt-1">{profile.pdp_number ?? "—"}</div>

                          <div className="text-sm text-gray-600 mt-3">PDP expiry</div>
                          <div className="font-medium mt-1">{profile.pdp_expiry ?? "—"}</div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border rounded-2xl p-4 space-y-3">
                    <div className="font-semibold">Verification Actions</div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded-xl px-4 py-2 text-white"
                        style={{ background: "var(--moovu-primary)" }}
                        disabled={busy}
                        onClick={() => updateVerificationStatus("approved")}
                      >
                        Approve Driver
                      </button>

                      <button
                        className="border rounded-xl px-4 py-2 bg-white text-black"
                        disabled={busy}
                        onClick={() => updateVerificationStatus("needs_more_info")}
                      >
                        Needs More Info
                      </button>

                      <button
                        className="border rounded-xl px-4 py-2 bg-white text-black"
                        disabled={busy}
                        onClick={() => updateVerificationStatus("rejected")}
                      >
                        Reject Verification
                      </button>

                      <button
                        className="border rounded-xl px-4 py-2 bg-white text-black"
                        disabled={busy}
                        onClick={() => updateVerificationStatus("pending_review")}
                      >
                        Set Pending Review
                      </button>
                    </div>
                  </div>

                  <div className="border rounded-2xl p-4 space-y-3">
                    <div className="font-semibold">Uploaded Documents</div>

                    {documents.length === 0 ? (
                      <div className="text-sm text-gray-700">No uploaded documents yet.</div>
                    ) : (
                      <div className="space-y-3">
                        {documents.map((doc) => (
                          <div key={doc.id} className="border rounded-2xl p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="font-medium">{docLabel(doc.document_type)}</div>
                                <div className="text-sm text-gray-700 mt-1">
                                  {doc.original_name ?? "Unnamed file"} • {doc.is_required ? "Required" : "Optional"}
                                </div>
                                <div className="text-xs text-gray-500 mt-1">
                                  Uploaded: {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : "—"}
                                </div>
                              </div>

                              <div className="text-sm text-gray-700">
                                Status: <span className="font-medium text-black">{doc.review_status ?? "pending"}</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2 mt-3">
                              <a
                                className="border rounded-xl px-4 py-2 bg-white text-black"
                                href={doc.file_url}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Open File
                              </a>

                              <button
                                className="rounded-xl px-4 py-2 text-white"
                                style={{ background: "var(--moovu-primary)" }}
                                disabled={busy}
                                onClick={() => updateDocumentReviewStatus(doc.id, "approved")}
                              >
                                Approve
                              </button>

                              <button
                                className="border rounded-xl px-4 py-2 bg-white text-black"
                                disabled={busy}
                                onClick={() => updateDocumentReviewStatus(doc.id, "needs_reupload")}
                              >
                                Needs Reupload
                              </button>

                              <button
                                className="border rounded-xl px-4 py-2 bg-white text-black"
                                disabled={busy}
                                onClick={() => updateDocumentReviewStatus(doc.id, "rejected")}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}