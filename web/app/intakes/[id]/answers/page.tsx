import { Suspense } from "react";
import AnswersScreen from "./answers-screen";

export default function AnswersPage() {
  return (
    // The intake id is known only when the page is opened. Without Suspense, pnpm build fails under
    // cacheComponents.
    <Suspense>
      <AnswersScreen />
    </Suspense>
  );
}
