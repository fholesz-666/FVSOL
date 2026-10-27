// Zkopíruje sdílený kód do složek Edge funkcí (Supabase nasazuje každou funkci samostatně).
// Spouštět po každé změně assets/zakazky/core.js nebo supabase/functions/_shared/*.
import { cpSync, mkdirSync, readdirSync, rmSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const shared = join(root, "supabase/functions/_shared");
copyFileSync(join(root, "assets/zakazky/core.js"), join(shared, "core.js"));
for (const fn of ["fvsol-intake", "fvsol-staff"]) {
  const dst = join(root, "supabase/functions", fn, "shared");
  rmSync(dst, { recursive: true, force: true });
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(shared)) if (!f.endsWith(".test.ts")) cpSync(join(shared, f), join(dst, f));
}
console.log("Sdílený kód zkopírován do fvsol-intake/shared a fvsol-staff/shared.");
