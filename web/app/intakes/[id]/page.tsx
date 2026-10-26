import { Suspense } from "react";
import IntakeScreen from "./intake-screen";

export default function IntakePage() {
  return (
    <main>
      {/* The intake id is known only when the page is opened. Without Suspense, pnpm build fails
          under cacheComponents. */}
      <Suspense>
        <IntakeScreen />
      </Suspense>
    </main>
  );
}
