import glyphs from "@react-native-vector-icons/ionicons/glyphmaps/Ionicons.json";
import fontUrl from "@react-native-vector-icons/ionicons/fonts/Ionicons.ttf?url";

const font = new FontFace("Ionicons", `url(${fontUrl})`);
document.fonts.add(font);
void font.load().catch(() => undefined);

export function Ionicons({ name, size, color }: { name: keyof typeof glyphs; size: number; color: string }) {
  return (
    <span aria-hidden="true" style={{ fontFamily: "Ionicons", fontSize: size, color, lineHeight: 1, flexShrink: 0 }}>
      {String.fromCodePoint(glyphs[name])}
    </span>
  );
}
