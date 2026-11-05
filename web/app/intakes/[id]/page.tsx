import { Suspense } from "react";
import layout from "../../layout.module.css";
import IntakeScreen from "./intake-screen";

export default function IntakePage() {
  return (
    // The intake id is known only when the page is opened. Without Suspense, pnpm build fails under
    // cacheComponents.
    <div className={layout.column}>
      <Suspense>
        <IntakeScreen />
      </Suspense>
    </div>
  );
}
