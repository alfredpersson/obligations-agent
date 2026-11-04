import styles from "./loading-status.module.css";

// The message while the next question is written, after the form or an answer is sent.
export const WRITING = "Writing the next question. This can take several seconds.";

// A loading indicator with a message that says what is happening. The element stays in the page
// while it is empty, so that screen readers announce a message when it appears.
export default function LoadingStatus({ message }: { message: string | null }) {
  return (
    <p role="status" className={styles.status}>
      {message && (
        <>
          <span className={styles.spinner} aria-hidden="true" />
          {message}
        </>
      )}
    </p>
  );
}
