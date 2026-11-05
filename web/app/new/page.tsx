import IntakeForm from "../intake-form";
import layout from "../layout.module.css";

// The form for the user's own product, which opens empty.
export default function NewIntake() {
  return (
    <div className={layout.column}>
      <h1>Describe your product</h1>
      <IntakeForm />
    </div>
  );
}
