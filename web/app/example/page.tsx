import { EXAMPLE } from "../example";
import IntakeForm from "../intake-form";
import layout from "../layout.module.css";

// The form with the example product filled in. Every field and answer can be changed.
export default function ExampleIntake() {
  return (
    <div className={layout.column}>
      <h1>Example product</h1>
      <p>Change any field or answer before you send the form.</p>
      <IntakeForm example={EXAMPLE} />
    </div>
  );
}
