"use client";

import { useState } from "react";
import { supabaseClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export default function NewDriverPage() {

  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  async function createDriver(e: React.FormEvent) {
    e.preventDefault();

    await supabaseClient.from("drivers").insert({
      first_name: firstName,
      last_name: lastName,
      phone: phone,
      email: email,
      status: "pending"
    });

    router.push("/admin/drivers");
  }

  return (
    <main className="p-6">

      <h1 className="text-2xl font-semibold mb-6">Add Driver</h1>

      <form onSubmit={createDriver} className="space-y-4 max-w-md">

        <input
          className="w-full border rounded-xl p-3"
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />

        <input
          className="w-full border rounded-xl p-3"
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />

        <input
          className="w-full border rounded-xl p-3"
          placeholder="Phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <input
          className="w-full border rounded-xl p-3"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button className="border rounded-xl px-4 py-2">
          Create Driver
        </button>

      </form>

    </main>
  );
}