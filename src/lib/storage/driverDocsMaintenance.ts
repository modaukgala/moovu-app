import type { SupabaseClient } from "@supabase/supabase-js";

export const DOCS_BUCKET = "driver-docs";
export const SHRINK_MIN_BYTES = 700_000;

export type StoredDoc = { path: string; size: number; mime: string };

/** Every file in driver-docs (paths are drivers/<driverId>/...). */
export async function listDriverDocs(db: SupabaseClient): Promise<StoredDoc[]> {
  const out: StoredDoc[] = [];
  const walk = async (prefix: string) => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await db.storage.from(DOCS_BUCKET).list(prefix, { limit: 100, offset });
      if (error) throw new Error(error.message);
      for (const item of data ?? []) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null) await walk(path); // folder
        else out.push({ path, size: Number(item.metadata?.size ?? 0), mime: String(item.metadata?.mimetype ?? "") });
      }
      if (!data || data.length < 100) break;
    }
  };
  await walk("");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function needsShrink(doc: StoredDoc) {
  return doc.mime === "image/jpeg" && doc.size > SHRINK_MIN_BYTES;
}
