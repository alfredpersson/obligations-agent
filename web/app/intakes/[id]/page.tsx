import { Suspense } from "react";
import IntakeScreen from "./intake-screen";

export default function IntakePage() {
  return (
    // The intake id is known only when the page is opened. Without Suspense, pnpm build fails under
    // cacheComponents. The screen sets its own width (preview: the rows at the page's width).
    <Suspense>
      <IntakeScreen />
    </Suspense>
  );
}
