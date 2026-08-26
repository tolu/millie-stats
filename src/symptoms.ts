// The four things we track. This constant is the ONLY place a symptom is
// defined: `id` is written into the stored JSON and must never change once
// data exists, `label` is what the interface shows, `help` is the one-line
// description shown under it and reused verbatim in the AI summary prompt.
//
// Adding a fifth symptom later means adding one entry here. No migration, no
// SQL, no change to the storage layer — that is the whole point of keeping the
// day's payload as a JSON blob.

export type Symptom = {
  readonly id: string;
  readonly label: string;
  readonly help: string;
  /** Chart colour, from the goggle palette in styles. */
  readonly color: string;
};

export const SYMPTOMS = [
  {
    id: "gnikking",
    label: "Gnikking",
    help: "Rullet og gned seg på ryggen om kvelden",
    color: "var(--blue)",
  },
  {
    id: "napping",
    label: "Napping",
    help: "Nappet og pirket i pelsen ved haleroten",
    color: "var(--blue-deep)",
  },
  {
    id: "lydsensitiv",
    label: "Lydsensitiv",
    help: "Bjeffet på helt vanlige kveldslyder",
    color: "var(--blue-mid)",
  },
  {
    id: "slow-walk",
    label: "Slow walk",
    help: "Brøt sammen på tur: hodet lavt, ørene stive",
    color: "var(--blue-light)",
  },
] as const satisfies readonly Symptom[];

export type SymptomId = (typeof SYMPTOMS)[number]["id"];

export function symptomById(id: string): Symptom | undefined {
  return SYMPTOMS.find((s) => s.id === id);
}
