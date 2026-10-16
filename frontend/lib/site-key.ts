// The key two site labels share when they name the same place: case, accents
// ("Çorum" / "Corum"), a trailing "?" and a type suffix ("Tokyo (city)") ignored.
// Mirrors SITE_KEY in backend/src/api/museum-object/services/place-group.js.
const FROM = "çğıöşüâêîôûáàäãåéèëíìïóòõúùñýÿčšžřďťňěůłńśźżćęāēīōūșțőűøđ"
const TO = "cgiosuaeiouaaaaaeeeiiiooouunyycszrdtneulnszzceaeioustouod"

export function siteKey(value?: string | null): string {
  let v = (value || "").trim().toLowerCase()
  v = Array.from(v, (ch) => { const i = FROM.indexOf(ch); return i >= 0 ? TO[i] : ch }).join("")
  v = v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  v = v.replace(/\s*\((city|province|provinz|stad|state|district|region|prov\.)\)\s*$/i, "")
  return v.replace(/\s*\?+\s*$/, "").trim()
}
