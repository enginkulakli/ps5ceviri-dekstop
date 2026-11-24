import { useState } from "react";

import { Button, Card, Field, Notice } from "@/src/components/ui";
import { type GlossaryEntry } from "@/src/settings";

export function GameGlossaryEditor({ entries, onSave }: { entries: GlossaryEntry[]; onSave: (entries: GlossaryEntry[]) => boolean }) {
  const [draft, setDraft] = useState(entries.map(({ source, target }) => `${source} = ${target}`).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = () => {
    const terms = new Map<string, GlossaryEntry>();
    for (const line of draft.split("\n").map((value) => value.trim()).filter(Boolean)) {
      const separator = line.indexOf("=");
      const source = separator > 0 ? line.slice(0, separator).trim() : "";
      const target = separator > 0 ? line.slice(separator + 1).trim() : "";
      if (!source || !target || source.length > 80 || target.length > 120) {
        setError("Her satıra en fazla 80 karakterlik İngilizce terim ve 120 karakterlik Türkçe karşılık yazın.");
        return;
      }
      terms.set(source.toLowerCase(), { source, target });
    }
    if (terms.size > 80) {
      setError("Sözlük en fazla 80 terim alabilir.");
      return;
    }
    if (!onSave([...terms.values()])) return;
    setError(null);
    setSaved(true);
  };

  return (
    <Card>
      <Field label="İngilizce terim = Türkçe karşılık" placeholder={"Kratos = Kratos\nOld Mine = Eski Maden"}
        hint="Her satıra bir terim yazın." multiline value={draft}
        onChangeText={(value) => { setDraft(value); setSaved(false); }} />
      <Button label="Sözlüğü kaydet" icon="checkmark-outline" onPress={save} />
      {error ? <Notice kind="error" text={error} /> : saved ? <Notice kind="success" text="Sözlük kaydedildi." /> : null}
    </Card>
  );
}
