import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Intake, Schema } from "../../service";

// Loads the intake and the schema for one of the intake's screens. redirect gives the address of the
// other screen when that one shows the intake as it is, and the screen then goes there in place of
// itself. Next.js keeps a page while another one shows, and runs this effect again when it shows
// again: the intake is loaded again, and what was loaded before does not show meanwhile, also from
// a load that ends after the page was hidden.
export function useIntake(id: string, redirect: (intake: Intake, id: string) => string | null) {
  const router = useRouter();
  const [data, setData] = useState<{ intake: Intake; schema: Schema } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    Promise.all([fetch(`/api/intakes/${id}`), fetch("/api/schema")])
      .then(async ([intakeResponse, schemaResponse]) => {
        if (intakeResponse.status === 404) {
          if (current) setMessage("This intake was not found.");
          return;
        }
        if (!intakeResponse.ok || !schemaResponse.ok) throw new Error();
        const intake = (await intakeResponse.json()) as Intake;
        const schema = (await schemaResponse.json()) as Schema;
        if (!current) return;
        const address = redirect(intake, id);
        if (address !== null) {
          router.replace(address);
          return;
        }
        setData({ intake, schema });
      })
      .catch(() => {
        if (current) setMessage("The answers could not be loaded. Reload the page to try again.");
      });
    return () => {
      current = false;
      setData(null);
      setMessage(null);
    };
  }, [id, router, redirect]);

  return { data, setData, message, setMessage };
}
