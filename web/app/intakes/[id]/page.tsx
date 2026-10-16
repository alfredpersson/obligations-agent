import { Suspense } from "react";
import RecordedAnswers from "./recorded-answers";

export default function IntakePage() {
  return (
    <main>
      <h1>Recorded answers</h1>
      {/* The intake id is known only when the page is opened. Without Suspense, pnpm build fails
          under cacheComponents. */}
      <Suspense>
        <RecordedAnswers />
      </Suspense>
    </main>
  );
}
